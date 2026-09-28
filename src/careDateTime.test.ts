import test from "node:test";
import assert from "node:assert/strict";
import { boundedCarePickerDate, updateCarePickerDate } from "./careDateTime";
import { careTime } from "./care";

const now = new Date(2026, 8, 18, 10, 4, 37).getTime();
const birthDate = "2026-07-01";

test("care picker permits the current minute and caps future selection", () => {
  const currentMinute = new Date(2026, 8, 18, 10, 4);
  assert.equal(
    boundedCarePickerDate(new Date(now), now, birthDate).getTime(),
    currentMinute.getTime(),
  );
  assert.equal(
    boundedCarePickerDate(
      new Date(2026, 8, 18, 10, 20),
      now,
      birthDate,
    ).getTime(),
    currentMinute.getTime(),
  );
  assert.equal(
    careTime("2026-09-18", "10:04", now, birthDate),
    currentMinute.toISOString(),
  );
});

test("care picker enforces birth date and recovers an invalid draft", () => {
  assert.equal(
    boundedCarePickerDate(
      new Date(2026, 5, 30, 23, 59),
      now,
      birthDate,
    ).getTime(),
    new Date(2026, 6, 1).getTime(),
  );
  assert.equal(
    boundedCarePickerDate(new Date(NaN), now, birthDate).getTime(),
    new Date(2026, 8, 18, 10, 4).getTime(),
  );
});

test("time changes preserve an edited record's day and do not mutate the original", () => {
  const original = new Date(2026, 7, 12, 9, 15);
  const selected = new Date(2026, 8, 18, 14, 30);
  const next = updateCarePickerDate(original, selected, "time", now, birthDate);
  assert.equal(next.getTime(), new Date(2026, 7, 12, 14, 30).getTime());
  assert.equal(original.getTime(), new Date(2026, 7, 12, 9, 15).getTime());
  assert.equal(selected.getTime(), new Date(2026, 8, 18, 14, 30).getTime());
});

test("date changes preserve the clock unless today would be in the future", () => {
  const original = new Date(2026, 7, 12, 14, 30);
  assert.equal(
    updateCarePickerDate(
      original,
      new Date(2026, 8, 17),
      "date",
      now,
      birthDate,
    ).getTime(),
    new Date(2026, 8, 17, 14, 30).getTime(),
  );
  assert.equal(
    updateCarePickerDate(
      original,
      new Date(2026, 8, 18),
      "date",
      now,
      birthDate,
    ).getTime(),
    new Date(2026, 8, 18, 10, 4).getTime(),
  );
});

test("time changes handle midnight without changing the chosen date", () => {
  assert.equal(
    updateCarePickerDate(
      new Date(2026, 8, 17, 23, 59),
      new Date(2026, 8, 18, 0, 0),
      "time",
      now,
      birthDate,
    ).getTime(),
    new Date(2026, 8, 17, 0, 0).getTime(),
  );
});

test("changing the day across daylight saving keeps the local clock", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Australia/Sydney";
  try {
    const current = new Date(2026, 9, 3, 9, 15);
    const result = updateCarePickerDate(
      current,
      new Date(2026, 9, 4),
      "date",
      new Date(2026, 9, 5).getTime(),
      birthDate,
    );
    assert.equal(result.getTime(), new Date(2026, 9, 4, 9, 15).getTime());
    assert.equal(result.getTime() - current.getTime(), 23 * 60 * 60 * 1000);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
