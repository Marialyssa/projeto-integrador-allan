import { parseDatabaseReading } from "./database-data.mjs";

const groupOnePrefix = "fazenda/grupo1/";

export function isGroupOneTopic(topic) {
  return typeof topic === "string" && topic.startsWith(groupOnePrefix);
}

export function parseTelemetry(topic, raw, timestamp = new Date().toISOString()) {
  const parts = topic.split("/");
  if (!isGroupOneTopic(topic) || parts[2] !== "sensores" || !parts[3]) return null;

  let payload;
  try {
    payload = JSON.parse(raw.toString());
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  const sensor = payload.sensor || payload.sensor_id || payload.device_id || parts[3];
  const reading = parseDatabaseReading(
    sensor,
    payload,
    payload.fazenda || payload.farm || "Fazenda Santa Helena",
    timestamp,
  );
  return reading ? { ...reading, topic } : null;
}
