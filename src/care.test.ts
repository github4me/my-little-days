import test from "node:test";
import assert from "node:assert/strict";
import { initialState, validateCareRecord, validateState } from "./domain";
import {
  careTime,
  parseTemperatureInput,
  defaultTemperatureMethod,
} from "./care";

test("temperature entry keeps decimals across keyboard formats and defaults to armpit", () => {
  assert.equal(defaultTemperatureMethod, "armpit");
  for (const input of ["36.8", "36,8", "３６．８", "３６，８", " 36.8 "])
    assert.equal(parseTemperatureInput(input), 36.8);
  for (const value of [25, 36, 36.85, 45])
    assert.equal(parseTemperatureInput(String(value)), value);
  for (const input of [
    "",
    "36.",
    "36..8",
    "36,8.5",
    "36.888",
    "36C",
    "3e1",
    "24.9",
    "45.01",
    "NaN",
  ])
    assert.throws(() => parseTemperatureInput(input));
});

const record = {
  id: "temp-1",
  kind: "temperature",
  time: "2026-09-08T09:00:00Z",
  note: "after waking",
  temperature: 36.85,
  method: "armpit",
};
test("care history survives backup round trip without changing old backups", () => {
  const state = validateState({
    ...initialState,
    careRecords: [
      record,
      { id: "bath-1", kind: "bath", time: record.time, note: "" },
    ],
  });
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))), state);
  assert.equal(state.careRecords?.[0].temperature, 36.85);
  assert.deepEqual(validateState(initialState), initialState);
  assert.equal("careRecords" in validateState(initialState), false);
  assert.throws(() =>
    validateState({ ...initialState, careRecords: [record, record] }),
  );
  assert.throws(() => validateState({ ...initialState, careRecords: null }));
});
test("care validation rejects invalid readings, methods, timestamps and unexpected fields", () => {
  for (const temperature of [NaN, Infinity, 0, 24.9, 45.1, "36.8", undefined])
    assert.throws(() => validateCareRecord({ ...record, temperature }));
  for (const method of ["guess", "", undefined])
    assert.throws(() => validateCareRecord({ ...record, method }));
  for (const time of [
    "2026-02-30T09:00:00Z",
    "2026-09-08T25:00:00Z",
    "2026-09-08T09:00:00",
    "bad",
  ])
    assert.throws(() => validateCareRecord({ ...record, time }));
  assert.throws(() => validateCareRecord({ ...record, kind: "bath" }));
  assert.throws(() => validateCareRecord({ ...record, diagnosis: "normal" }));
  assert.equal(
    validateCareRecord({ ...record, temperature: 38 }).temperature,
    38,
  );
  for (const kind of ["bath", "wash", "oral", "nails"])
    assert.equal(
      validateCareRecord({ id: kind, kind, time: record.time, note: "" }).kind,
      kind,
    );
});
test("care entry time checks calendar dates, future entries and birth boundary", () => {
  const now = new Date(2026, 8, 8, 15, 0).getTime();
  assert.equal(
    careTime("2026-09-08", "14:30", now, "2026-07-01"),
    new Date(2026, 8, 8, 14, 30).toISOString(),
  );
  for (const [date, time] of [
    ["2026-02-30", "14:30"],
    ["2026-09-08", "25:00"],
    ["2026-09-09", "14:30"],
    ["2026-06-30", "14:30"],
    ["2026-09-08", "9:00"],
  ])
    assert.throws(() => careTime(date, time, now, "2026-07-01"));
});

test("supplements round trip with multiple choices and custom name without doses", () => {
  const supplement = {
    id: "supp-1",
    kind: "supplement",
    time: record.time,
    note: "Given as advised",
    supplements: ["vitamin-d", "probiotics", "iron", "other"],
    otherSupplement: "Custom product",
  };
  assert.deepEqual(validateCareRecord(supplement), supplement);
  const state = { ...initialState, careRecords: [supplement] };
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))), state);
  for (const supplements of [
    undefined,
    [],
    ["vitamin-d", "vitamin-d"],
    ["unknown"],
    [42],
    "vitamin-d",
  ])
    assert.throws(() => validateCareRecord({ ...supplement, supplements }));
  for (const otherSupplement of [undefined, "", "  ", "x".repeat(101)])
    assert.throws(() => validateCareRecord({ ...supplement, otherSupplement }));
  assert.throws(() =>
    validateCareRecord({ ...supplement, supplements: ["vitamin-d"] }),
  );
  assert.throws(() => validateCareRecord({ ...supplement, kind: "bath" }));
  assert.throws(() => validateCareRecord({ ...supplement, dose: 400 }));
});
