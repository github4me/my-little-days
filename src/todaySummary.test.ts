import assert from "node:assert/strict";
import test from "node:test";
import { summarizeToday } from "./todaySummary";
import type { Entry } from "./domain";

test("today widget/phone show known zeros rather than missing values", () => {
  const summary = summarizeToday([], new Date(2026, 8, 18, 12));
  assert.equal(summary.feedMl, 0);
  assert.equal(summary.diaperCount, 0);
  assert.equal(summary.sleepMinutes, 0);
});
test("today includes edited amounts and ongoing sleep only up to the snapshot time", () => {
  const now = new Date(2026, 8, 18, 1);
  const iso = (day: number, hour: number) =>
    new Date(2026, 8, day, hour).toISOString();
  const records: Entry[] = [
    {
      id: "a",
      type: "feed",
      start: iso(18, 0),
      amount: 150,
      feedKind: "formula",
      note: "",
    },
    {
      id: "b",
      type: "feed",
      start: iso(17, 23),
      amount: 90,
      feedKind: "formula",
      note: "",
    },
    {
      id: "c",
      type: "diaper",
      start: iso(18, 0),
      diaperKind: "mixed",
      note: "",
    },
    { id: "d", type: "sleep", start: iso(17, 23), note: "" },
  ];
  const summary = summarizeToday(records, now);
  assert.equal(summary.feedMl, 150);
  assert.equal(summary.diaperCount, 1);
  assert.equal(summary.sleepMinutes, 60);
  assert.equal(
    summarizeToday(
      records.map((r) => (r.id === "a" ? { ...r, amount: 120 } : r)),
      now,
    ).feedMl,
    120,
  );
  assert.equal(
    records[3].end,
    undefined,
    "summary must not finish a real timer",
  );
});
test("overlapping sleep is not double counted and midnight resets statistics", () => {
  const start = new Date(2026, 8, 18, 0).toISOString();
  const entries: Entry[] = [
    { id: "a", type: "sleep", start, note: "" },
    {
      id: "b",
      type: "sleep",
      start,
      end: new Date(2026, 8, 18, 1).toISOString(),
      note: "",
    },
  ];
  assert.equal(
    summarizeToday(entries, new Date(2026, 8, 18, 2)).sleepMinutes,
    120,
  );
  assert.equal(
    summarizeToday(entries, new Date(2026, 8, 19, 0)).sleepMinutes,
    0,
  );
});
