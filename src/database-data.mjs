function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseDatabaseReading(sensor, rawData, farmName, timestampFallback) {
  let data;
  try {
    data = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
  } catch {
    return null;
  }

  if (!data || typeof data !== "object") return null;
  const values = data.valores || data.values || data;
  const timestampValue = data.ts || timestampFallback;
  const parsedTimestamp = timestampValue ? new Date(timestampValue) : new Date();
  const timestamp = Number.isNaN(parsedTimestamp.getTime()) ? new Date().toISOString() : parsedTimestamp.toISOString();
  const resolvedSensor = sensor || data.sensor || "Sensor";
  const plot = data.talhao || null;

  return {
    topic: `grupo/1/${plot || "fazenda"}/${resolvedSensor}`,
    timestamp,
    farm: farmName || "Fazenda do Grupo 1",
    sensor: resolvedSensor,
    sensorId: resolvedSensor,
    plot,
    temperature: parseNumber(values.temp_solo_c ?? values.temperatura_solo_c ?? values.temp_ar_c ?? values.temperatura),
    humidity: parseNumber(values.umidade_10cm_pct ?? values.umidade_ar_pct ?? values.umidade),
    battery: parseNumber(data.bateria_pct),
    value: undefined,
    unit: "",
  };
}
