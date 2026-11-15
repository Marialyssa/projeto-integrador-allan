import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

const pdfPath = resolve("PI2026-T2-acessos.pdf");
const result = spawnSync("pdftotext", ["-layout", pdfPath, "-"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});

if (result.error || result.status !== 0) {
  throw new Error("Não foi possível ler o PDF de acessos. Verifique se pdftotext está instalado.");
}

const lines = result.stdout.split(/\r?\n/);
const serviceLine = (name) => lines.find((line) => new RegExp(`^\\s*${name}:?\\s`, "i").test(line));

function parseService(name) {
  const line = serviceLine(name);
  if (!line) throw new Error(`A configuração de ${name} não foi encontrada no PDF.`);

  const match = line.match(/(\S+):(\d+)\s+(\S+)(?:\s+(\S+))?\s*$/);
  if (!match) throw new Error(`A configuração de ${name} no PDF não tem o formato esperado.`);

  const user = match[4] ? match[3] : "";
  const password = match[4] || match[3];
  return {
    host: match[1],
    port: match[2],
    user: /^[-—_]$/.test(user) ? "" : user,
    password,
  };
}

function encode(value) {
  return encodeURIComponent(value);
}

const maria = parseService("MariaDB");
const mongo = parseService("MongoDB");
const redis = parseService("Redis");
const mqtt = parseService("MQTT");
const apiLine = serviceLine("API");
const apiFields = apiLine?.trim().split(/\s+/) || [];
if (apiFields.length < 4) throw new Error("O endpoint e as credenciais S3-compatible não foram encontrados no PDF.");
const minioUrl = new URL(apiFields[1].includes("://") ? apiFields[1] : `http://${apiFields[1]}`);
const minioEndpoint = minioUrl.toString().replace(/\/$/, "");


const databaseLine = lines.find((line) => /^\s*banco\b/i.test(line));
const database = databaseLine?.match(/^\s*banco\s*:?\s+(\S+)/i)?.[1];
if (!database) throw new Error("O banco de dados MariaDB não foi encontrado no PDF.");

const existing = existsSync(".env") ? dotenv.parse(readFileSync(".env", "utf8")) : {};
const values = {
  GROUP_ID: "1",
  PORT: existing.PORT || "3000",
  MARIADB_URL: `mariadb://${encode(maria.user)}:${encode(maria.password)}@${maria.host}:${maria.port}/${encode(database)}`,
  MONGODB_URI: `mongodb://${encode(mongo.user)}:${encode(mongo.password)}@${mongo.host}:${mongo.port}/?authSource=admin`,
  REDIS_URL: `redis://${redis.user ? `${encode(redis.user)}:` : ":"}${encode(redis.password)}@${redis.host}:${redis.port}`,
  MQTT_URL: `mqtt://${encode(mqtt.user)}:${encode(mqtt.password)}@${mqtt.host}:${mqtt.port}`,
  MQTT_TOPIC: existing.MQTT_TOPIC && existing.MQTT_TOPIC !== "grupo/1/"
    ? existing.MQTT_TOPIC
    : "grupo/1/#",
  MINIO_ENDPOINT: minioEndpoint,
  MINIO_ACCESS_KEY: apiFields[2],
  MINIO_SECRET_KEY: apiFields[3],
  MINIO_BUCKET: existing.MINIO_BUCKET || "grupo1",
  MINIO_REGION: existing.MINIO_REGION || "us-east-1",
};

writeFileSync(".env", `${Object.entries(values)
  .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  .join("\n")}\n`, {
  mode: 0o600,
});
chmodSync(".env", 0o600);
console.log("Configuração local do Grupo 1 criada em .env (arquivo ignorado pelo Git).");
