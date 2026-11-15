import test from "node:test";
import assert from "node:assert/strict";
import { isGroupOneTopic, parseTelemetry } from "../src/telemetry.mjs";
import { parseDatabaseReading } from "../src/database-data.mjs";

test("only accepts topics scoped to Grupo 1", () => {
  assert.equal(isGroupOneTopic("grupo/1/fazenda-2/sensor-1"), true);
  assert.equal(isGroupOneTopic("grupo/2/fazenda-2/sensor-1"), false);
});

test("normalizes telemetry fields without inventing missing measurements", () => {
  const reading = parseTelemetry(
    "grupo/1/fazenda-2/solo",
    Buffer.from('{"fazenda":"Santa Luzia","sensor_id":"solo-01","temperatura":23.4,"umidade":61}'),
    "2026-10-08T12:00:00.000Z",
  );

  assert.deepEqual(reading, {
    topic: "grupo/1/fazenda-2/solo",
    timestamp: "2026-10-08T12:00:00.000Z",
    farm: "Santa Luzia",
    sensorId: "solo-01",
    sensor: "solo-01",
    temperature: 23.4,
    humidity: 61,
    value: undefined,
    unit: "",
  });
});

test("handles non-JSON MQTT payloads without fabricating sensor data", () => {
  const reading = parseTelemetry("grupo/1/fazenda-1/raw", Buffer.from("online"));
  assert.equal(reading.value, "online");
  assert.equal(reading.farm, null);
  assert.equal(reading.sensorId, null);
  assert.equal(reading.temperature, null);
  assert.equal(reading.humidity, null);
});

test("normalizes nested MongoDB sensor telemetry", () => {
  const reading = parseDatabaseReading("SS-03", {
    talhao: "T03",
    ts: "2026-10-08T18:00:00.000Z",
    bateria_pct: 81,
    valores: {
      temp_solo_c: 24.6,
      umidade_10cm_pct: 32.1,
    },
  }, "Fazenda Santa Helena");

  assert.equal(reading.farm, "Fazenda Santa Helena");
  assert.equal(reading.sensor, "SS-03");
  assert.equal(reading.plot, "T03");
  assert.equal(reading.temperature, 24.6);
  assert.equal(reading.humidity, 32.1);
  assert.equal(reading.battery, 81);
});

test("ignores malformed historical telemetry instead of crashing refresh", () => {
  assert.equal(parseDatabaseReading("SS-01", "{bad json"), null);
});
