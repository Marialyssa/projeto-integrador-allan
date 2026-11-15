import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import mariadb from "mariadb";
import { MongoClient } from "mongodb";
import mqtt from "mqtt";
import { createClient } from "redis";
import { parseDatabaseReading } from "./src/database-data.mjs";
import { parseTelemetry, isGroupOneTopic } from "./src/telemetry.mjs";
import { listBucketObjects } from "./src/minio.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 3000);
const groupId = "1";
const mqttTopic = process.env.MQTT_TOPIC || "fazenda/grupo1/#";
if (!mqttTopic.startsWith("fazenda/grupo1/")) {
  throw new Error("MQTT_TOPIC deve limitar a inscrição aos dados do Grupo 1.");
}
const history = [];
const maxHistory = 300;
let mariaPool;
let mongoClient;
let mongoGroup;
let redisClient;
let mqttClient;
let minioObjectKeys = new Set();
let mariaConnecting = false;
let mongoConnecting = false;
let redisConnecting = false;
let databaseData = {
  farm: null,
  plots: [],
  sensors: [],
  readings: [],
  historicalReadings: [],
  images: [],
  imageReferences: [],
  alerts: [],
  machines: [],
  chart: [],
  metrics: {
    farmCount: 0,
    sensorCount: 0,
    imageCount: 0,
    minioObjectCount: null,
    imageReferenceCount: null,
    imageReferencesFound: null,
    imageReferencesMissing: null,
    orphanMinioObjects: null,
    activeSensors: 0,
    historicalReadings: 0,
    latestTemperature: null,
    openAlerts: 0,
    machineReadings: 0,
  },
};

const integrations = {
  mariadb: { name: "MariaDB", configured: Boolean(process.env.MARIADB_URL), connected: false, detail: "Aguardando conexão" },
  mongodb: { name: "MongoDB", configured: Boolean(process.env.MONGODB_URI), connected: false, detail: "Aguardando conexão" },
  redis: { name: "Redis", configured: Boolean(process.env.REDIS_URL), connected: false, detail: "Aguardando conexão" },
  mqtt: { name: "MQTT", configured: Boolean(process.env.MQTT_URL), connected: false, detail: "Aguardando conexão" },
  minio: { name: "MinIO", configured: Boolean(process.env.MINIO_ENDPOINT && process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY), connected: false, detail: "Aguardando conexão" },
};

const safeIntegrationStatus = () => Object.entries(integrations).map(([id, item]) => ({
  id,
  name: item.name,
  configured: item.configured,
  connected: item.connected,
  detail: item.detail,
}));

function safeErrorCode(error) {
  const code = error?.code;
  if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) return code;
  const message = typeof error?.message === "string" ? error.message : "";
  const knownCodes = ["WRONGPASS", "NOAUTH", "NOPERM", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND"];
  const messageCode = knownCodes.find((candidate) => message.includes(candidate));
  if (messageCode) return messageCode;
  const name = error?.constructor?.name;
  return typeof name === "string" && /^[A-Za-z0-9_]+$/.test(name) ? name : "ERRO";
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function addReading(topic, raw) {
  if (!isGroupOneTopic(topic)) return;
  const entry = parseTelemetry(topic, raw);
  if (!entry) return;
  history.unshift(entry);
  if (history.length > maxHistory) history.pop();
}

async function connectMariaDB() {
  if (!process.env.MARIADB_URL || mariaPool || mariaConnecting) return;
  mariaConnecting = true;
  try {
    const url = new URL(process.env.MARIADB_URL);
    mariaPool = mariadb.createPool({
      host: url.hostname,
      port: Number(url.port),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: "grupo1",
      connectionLimit: 4,
      connectTimeout: 5000,
    });
    const connection = await mariaPool.getConnection();
    await connection.query("SELECT 1");
    connection.release();
    integrations.mariadb.connected = true;
    integrations.mariadb.detail = "Conectado · esquema Grupo 1";
  } catch (error) {
    integrations.mariadb.connected = false;
    integrations.mariadb.detail = `Falha ao conectar (${safeErrorCode(error)})`;
    if (mariaPool) await mariaPool.end().catch(() => {});
    mariaPool = undefined;
  } finally {
    mariaConnecting = false;
  }
}

async function connectMongoDB() {
  if (!process.env.MONGODB_URI || mongoClient || mongoConnecting) return;
  mongoConnecting = true;
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await mongoClient.connect();
    mongoGroup = mongoClient.db("grupo1");
    await mongoGroup.command({ ping: 1 });
    integrations.mongodb.connected = true;
    integrations.mongodb.detail = "Conectado · banco Grupo 1";
  } catch (error) {
    integrations.mongodb.connected = false;
    integrations.mongodb.detail = `Falha ao conectar (${safeErrorCode(error)})`;
    await mongoClient?.close().catch(() => {});
    mongoClient = undefined;
    mongoGroup = undefined;
  } finally {
    mongoConnecting = false;
  }
}

async function connectRedis() {
  if (!process.env.REDIS_URL || redisClient || redisConnecting) return;
  redisConnecting = true;
  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries, error) => {
        if (["WRONGPASS", "NOAUTH", "NOPERM"].includes(error?.code) || retries >= 3) {
          return new Error("Falha ao conectar ao Redis.");
        }
        return Math.min(1000 * 2 ** retries, 5000);
      },
    },
  });
  redisClient.on("error", (error) => {
    integrations.redis.connected = false;
    integrations.redis.detail = `Falha na conexão (${safeErrorCode(error)})`;
  });
  redisClient.on("reconnecting", () => {
    integrations.redis.connected = false;
    integrations.redis.detail = "Reconectando";
  });
  redisClient.on("ready", () => {
    integrations.redis.connected = true;
    integrations.redis.detail = "Conectado · dados do Grupo 1";
  });
  try {
    await redisClient.connect();
    await redisClient.ping();
    integrations.redis.connected = true;
    integrations.redis.detail = "Conectado · dados do Grupo 1";
  } catch (error) {
    integrations.redis.detail = `Falha ao conectar (${safeErrorCode(error)})`;
    if (redisClient.isOpen) await redisClient.quit().catch(() => {});
    redisClient = undefined;
  } finally {
    redisConnecting = false;
  }
}

function connectMqtt() {
  if (!process.env.MQTT_URL) return;
  mqttClient = mqtt.connect(process.env.MQTT_URL, {
    connectTimeout: 5000,
    reconnectPeriod: 5000,
    clean: true,
  });
  mqttClient.on("connect", () => {
    integrations.mqtt.connected = true;
    integrations.mqtt.detail = `Inscrito em ${mqttTopic}`;
    mqttClient.subscribe(mqttTopic, (error) => {
      if (error) integrations.mqtt.detail = "Falha ao assinar tópico";
    });
  });
  mqttClient.on("message", (topic, payload) => addReading(topic, payload));
  mqttClient.on("close", () => {
    integrations.mqtt.connected = false;
    integrations.mqtt.detail = "Desconectado";
  });
  mqttClient.on("error", (error) => {
    integrations.mqtt.connected = false;
    integrations.mqtt.detail = `Falha na conexão (${safeErrorCode(error)})`;
  });
}

async function scanGroupOneKeys(pattern) {
  const keys = [];
  let cursor = 0;
  for (let page = 0; page < 30; page += 1) {
    const result = await redisClient.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = Number(result.cursor);
    keys.push(...result.keys);
    if (cursor === 0) return keys;
  }
  throw new Error("A consulta Redis excedeu o limite de páginas para as chaves do Grupo 1.");
}

async function refreshMariaDB() {
  if (!mariaPool) return;
  let connection;
  try {
    connection = await mariaPool.getConnection();
    const farms = await connection.query(
      "SELECT id, nome, municipio, uf, area_total_ha FROM fazenda ORDER BY id",
    );
    const plots = await connection.query(
      "SELECT t.codigo, t.area_ha, t.tipo_solo, c.nome AS cultura FROM talhao t LEFT JOIN cultura c ON c.id = t.cultura_atual_id ORDER BY t.codigo",
    );
    const sensors = await connection.query(
      "SELECT s.codigo, s.tipo, t.codigo AS talhao, s.fabricante, s.instalado_em, s.intervalo_min FROM sensor s LEFT JOIN talhao t ON t.id = s.talhao_id ORDER BY s.codigo",
    );
    const [schema] = await connection.query(
      "SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
    );
    databaseData.farm = farms[0] || databaseData.farm;
    databaseData.plots = plots;
    databaseData.sensors = sensors;
    databaseData.metrics.farmCount = farms.length || (databaseData.farm ? 1 : 0);
    databaseData.metrics.sensorCount = sensors.length;
    integrations.mariadb.connected = true;
    integrations.mariadb.detail = `Grupo 1 · ${Number(schema.total)} tabelas`;
  } catch (error) {
    integrations.mariadb.connected = false;
    integrations.mariadb.detail = `Falha na consulta (${safeErrorCode(error)})`;
    console.error(`Consulta MariaDB do Grupo 1 falhou: ${safeErrorCode(error)}`);
  } finally {
    connection?.release();
  }
}

async function refreshMongoDB() {
  if (!mongoGroup) return;
  try {
    const [historicalReadings, totalAlerts, openAlerts, machineReadings, imageCount, recentReadings, recentAlerts, recentMachines, recentImages, imageReferences] = await Promise.all([
      mongoGroup.collection("leituras").estimatedDocumentCount(),
      mongoGroup.collection("alertas").estimatedDocumentCount(),
      mongoGroup.collection("alertas").countDocuments({ resolvido: false }, { maxTimeMS: 5000 }),
      mongoGroup.collection("telemetria_maquinas").estimatedDocumentCount(),
      mongoGroup.collection("imagens").estimatedDocumentCount(),
      mongoGroup.collection("leituras")
        .find({}, { projection: { _id: 0 }, maxTimeMS: 5000 })
        .sort({ ts: -1 }).limit(12).toArray(),
      mongoGroup.collection("alertas")
        .find({}, { projection: { _id: 0 }, maxTimeMS: 5000 })
        .sort({ ts: -1 }).limit(6).toArray(),
      mongoGroup.collection("telemetria_maquinas")
        .find({}, { projection: { _id: 0 }, maxTimeMS: 5000 })
        .sort({ ts: -1 }).limit(6).toArray(),
      mongoGroup.collection("imagens")
        .find({}, { projection: { _id: 0 }, maxTimeMS: 5000 })
        .sort({ data: -1 }).limit(8).toArray(),
      mongoGroup.collection("imagens")
        .find({}, { projection: { _id: 0, bucket: 1, objeto: 1 }, maxTimeMS: 5000 })
        .toArray(),
    ]);
    databaseData.metrics.historicalReadings = historicalReadings;
    databaseData.metrics.openAlerts = openAlerts;
    databaseData.metrics.machineReadings = machineReadings;
    databaseData.historicalReadings = recentReadings
      .map((reading) => parseDatabaseReading(reading.sensor, reading, databaseData.farm?.nome))
      .filter(Boolean);
    databaseData.alerts = recentAlerts;
    databaseData.machines = recentMachines;
    databaseData.images = recentImages;
    databaseData.imageReferences = imageReferences;
    databaseData.metrics.imageCount = imageCount;
    updateImageObjectStatus();
    const statusCollections = [
      `${historicalReadings.toLocaleString("pt-BR")} leituras`,
      `${totalAlerts} alertas`,
      `${machineReadings.toLocaleString("pt-BR")} posições`,
      `${imageCount.toLocaleString("pt-BR")} imagens`,
    ];
    integrations.mongodb.connected = true;
    integrations.mongodb.detail = `Grupo 1 · ${statusCollections.join(" · ")}`;
    updateImageObjectStatus();
  } catch (error) {
    integrations.mongodb.connected = false;
    integrations.mongodb.detail = `Falha na consulta (${safeErrorCode(error)})`;
    console.error(`Consulta MongoDB do Grupo 1 falhou: ${safeErrorCode(error)}`);
  }
}

async function refreshRedis() {
  if (!redisClient?.isOpen) return;
  try {
    await redisClient.ping();
    const farmRecord = await redisClient.hGetAll("grupo1:fazenda");
    const plotKeys = await scanGroupOneKeys("grupo1:talhao:*");
    const sensorKeys = await scanGroupOneKeys("grupo1:sensor:*");
    const [stream, counter, plots, sensors] = await Promise.all([
      redisClient.xRevRange("grupo1:stream:leituras", "+", "-", { COUNT: 48 }),
      redisClient.get("grupo1:contador:leituras_ao_vivo"),
      Promise.all(plotKeys.sort().map((key) => redisClient.hGetAll(key))),
      Promise.all(sensorKeys.sort().map((key) => redisClient.hGetAll(key))),
    ]);
    const latestBySensor = new Map();
    for (const entry of stream) {
      let data;
      try {
        data = JSON.parse(entry.message.json || "{}");
      } catch {
        continue;
      }
      if (!latestBySensor.has(entry.message.sensor)) latestBySensor.set(entry.message.sensor, data);
    }
    const sensorReadings = [...latestBySensor.entries()]
      .map(([sensor, data]) => parseDatabaseReading(sensor, data, farmRecord.nome))
      .filter(Boolean);
    const sortedSensors = sensorKeys.sort().map((key, index) => ({
      id: key.split(":").at(-1),
      ...sensors[index],
    }));
    const activeSensors = sortedSensors.filter((sensor) => {
      const timestamp = Date.parse(sensor.ts || "");
      return Number.isFinite(timestamp) && Date.now() - timestamp < 30 * 60 * 1000;
    }).length;
    const redisFarm = Object.keys(farmRecord).length ? {
      nome: farmRecord.nome,
      municipio: farmRecord.municipio,
      area_total_ha: farmRecord.area_total_ha,
      talhoes: Number(farmRecord.talhoes),
    } : null;
    if (!databaseData.farm && redisFarm) {
      databaseData.farm = redisFarm;
      databaseData.metrics.farmCount = 1;
    }
    const redisPlots = plotKeys.sort().map((key, index) => ({
      codigo: key.split(":").at(-1),
      ...plots[index],
    }));
    const redisPlotByCode = new Map(redisPlots.map((plot) => [plot.codigo, plot]));
    databaseData.plots = databaseData.plots.length
      ? databaseData.plots.map((plot) => ({ ...plot, ...redisPlotByCode.get(plot.codigo) }))
      : redisPlots;
    databaseData.readings = [...sensorReadings, ...history]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, 12);
    databaseData.chart = sensorReadings
      .filter((reading) => Number.isFinite(reading.temperature))
      .reverse()
      .map((reading) => ({
        time: new Date(reading.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        value: reading.temperature,
      }));
    databaseData.metrics.activeSensors = activeSensors;
    databaseData.metrics.liveReadings = parseNumber(counter) || 0;
    databaseData.metrics.latestTemperature = sensorReadings.find((reading) => Number.isFinite(reading.temperature))?.temperature ?? null;
    integrations.redis.connected = true;
    integrations.redis.detail = `Grupo 1 · ${plotKeys.length} talhões · ${sensorKeys.length} sensores`;
  } catch (error) {
    integrations.redis.connected = false;
    integrations.redis.detail = `Falha na consulta (${safeErrorCode(error)})`;
    console.error(`Consulta Redis do Grupo 1 falhou: ${safeErrorCode(error)}`);
  }
}

function updateImageObjectStatus() {
  const bucket = process.env.MINIO_BUCKET || "grupo1";
  const canReconcile = integrations.mongodb.connected && integrations.minio.connected;
  const references = databaseData.imageReferences
    .filter((image) => image.bucket === bucket && typeof image.objeto === "string" && image.objeto.length > 0);
  const referencedKeys = new Set(references.map((image) => image.objeto));
  databaseData.metrics.imageReferenceCount = integrations.mongodb.connected ? referencedKeys.size : null;
  databaseData.metrics.minioObjectCount = integrations.minio.connected ? minioObjectKeys.size : null;
  databaseData.metrics.imageReferencesFound = canReconcile
    ? [...referencedKeys].filter((key) => minioObjectKeys.has(key)).length
    : null;
  databaseData.metrics.imageReferencesMissing = canReconcile
    ? [...referencedKeys].filter((key) => !minioObjectKeys.has(key)).length
    : null;
  databaseData.metrics.orphanMinioObjects = canReconcile
    ? [...minioObjectKeys].filter((key) => !referencedKeys.has(key)).length
    : null;
  databaseData.images = databaseData.images.map((image) => ({
    ...image,
    objectPresent: canReconcile && image.bucket === bucket ? minioObjectKeys.has(image.objeto) : null,
  }));
}

async function refreshMinIO() {
  if (!integrations.minio.configured) return;
  try {
    minioObjectKeys = new Set(await listBucketObjects({
      endpoint: process.env.MINIO_ENDPOINT,
      bucket: process.env.MINIO_BUCKET || "grupo1",
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
      region: process.env.MINIO_REGION || "us-east-1",
    }));
    integrations.minio.connected = true;
    integrations.minio.detail = `${process.env.MINIO_BUCKET || "grupo1"} · ${minioObjectKeys.size} objetos`;
    updateImageObjectStatus();
  } catch (error) {
    integrations.minio.connected = false;
    integrations.minio.detail = `Falha na consulta (${safeErrorCode(error)})`;
    minioObjectKeys = new Set();
    updateImageObjectStatus();
  }
}

function summarize() {
  return {
    groupId,
    integrations: safeIntegrationStatus(),
    farm: databaseData.farm,
    plots: databaseData.plots,
    sensors: databaseData.sensors,
    metrics: {
      ...databaseData.metrics,
      plotCount: databaseData.plots.length,
      mappedArea: databaseData.plots.reduce((sum, plot) => sum + (parseNumber(plot.area_ha) || 0), 0),
      unallocatedArea: (() => {
        const farmArea = parseNumber(databaseData.farm?.area_total_ha);
        if (farmArea === null) return null;
        const mapped = databaseData.plots.reduce((sum, plot) => sum + (parseNumber(plot.area_ha) || 0), 0);
        return Math.round((farmArea - mapped) * 100) / 100;
      })(),
    },
    history: databaseData.readings,
    historicalReadings: databaseData.historicalReadings,
    images: databaseData.images,
    alerts: databaseData.alerts,
    machines: databaseData.machines,
    chart: databaseData.chart,
  };
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");

  if (url.pathname === "/health" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("ok");
    return;
  }

  if (url.pathname === "/api/dashboard") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(summarize()));
    return;
  }

  if (url.pathname === "/api/integrations") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(safeIntegrationStatus()));
    return;
  }

  const requestedPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = normalize(join(publicDir, requestedPath));
  if (!filePath.startsWith(`${publicDir}/`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

function refreshAll() {
  if (mariaPool && !mariaConnecting) void refreshMariaDB();
  else if (!mariaConnecting) void connectMariaDB().then(refreshMariaDB);

  if (mongoGroup && !mongoConnecting) void refreshMongoDB();
  else if (!mongoConnecting) void connectMongoDB().then(refreshMongoDB);

  if (redisClient?.isOpen && !redisConnecting) void refreshRedis();
  else if (!redisConnecting) void connectRedis().then(refreshRedis);

  void refreshMinIO();
}

connectMqtt();
server.listen(port, "0.0.0.0", () => {
  console.log(`AgroGestor disponível na porta ${port}`);
});
refreshAll();
setInterval(refreshAll, 10000);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(async () => {
      await Promise.allSettled([
        mariaPool?.end(),
        mongoClient?.close(),
        redisClient?.isOpen ? redisClient.quit() : Promise.resolve(),
      ]);
      mqttClient?.end(true);
      process.exit(0);
    });
  });
}
