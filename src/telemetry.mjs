export function isGroupOneTopic(topic) {
  return topic.startsWith("grupo/1/");
}

export function parseTelemetry(topic, raw, timestamp = new Date().toISOString()) {
  let payload;
  try {
    payload = JSON.parse(raw.toString());
  } catch {
    payload = { value: raw.toString() };
  }

  const rawTemperature = payload.temperature ?? payload.temperatura;
  const rawHumidity = payload.humidity ?? payload.umidade;
  const temperature = rawTemperature === "" || rawTemperature === null || rawTemperature === undefined
    ? Number.NaN
    : Number(rawTemperature);
  const humidity = rawHumidity === "" || rawHumidity === null || rawHumidity === undefined
    ? Number.NaN
    : Number(rawHumidity);
  const farm = payload.farm || payload.fazenda;
  const sensorId = payload.sensor || payload.sensor_id || payload.device_id;
  return {
    topic,
    timestamp,
    farm: farm ? String(farm) : null,
    sensorId: sensorId ? String(sensorId) : null,
    sensor: sensorId ? String(sensorId) : "Sensor sem identificação",
    temperature: Number.isFinite(temperature) ? temperature : null,
    humidity: Number.isFinite(humidity) ? humidity : null,
    value: payload.value,
    unit: String(payload.unit || payload.unidade || ""),
  };
}
