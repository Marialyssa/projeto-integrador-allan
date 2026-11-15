import test from "node:test";
import assert from "node:assert/strict";
import { isGroupOneTopic, parseTelemetry } from "../src/telemetry.mjs";
import { parseDatabaseReading } from "../src/database-data.mjs";

test("only accepts topics scoped to Grupo 1", () => {
  assert.equal(isGroupOneTopic("fazenda/grupo1/sensores/SS-03"), true);
  assert.equal(isGroupOneTopic("fazenda/grupo2/sensores/SS-03"), false);
});

test("normalizes telemetry fields without inventing missing measurements", () => {
  const reading = parseTelemetry(
    "fazenda/grupo1/sensores/SS-03",
    Buffer.from('{"sensor":"SS-03","tipo":"sonda_solo","talhao":"T03","ts":"2026-10-08T12:00:00.000Z","valores":{"temp_solo_c":23.4,"umidade_10cm_pct":61}}'),
    "2026-10-08T12:00:00.000Z",
  );

  assert.deepEqual(reading, {
    topic: "fazenda/grupo1/sensores/SS-03",
    timestamp: "2026-10-08T12:00:00.000Z",
    farm: "Fazenda Santa Helena",
    sensor: "SS-03",
    sensorId: "SS-03",
    plot: "T03",
    temperature: 23.4,
    humidity: 61,
    battery: null,
    value: undefined,
    unit: "",
  });
});

test("ignores non-sensor MQTT topics and malformed sensor JSON", () => {
  assert.equal(parseTelemetry("fazenda/grupo1/status", Buffer.from("online")), null);
  assert.equal(parseTelemetry("fazenda/grupo1/sensores/SS-01", Buffer.from("{bad json")), null);
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
