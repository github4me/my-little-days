import test from "node:test";
import assert from "node:assert/strict";
import { Entry } from "./domain";
import { feedAmountPresets } from "./feedAmountPresets";

const currentAmounts = [60, 90, 120, 150];

test("formula shortcuts change after the first seven calendar days", () => {
  for (const [recordDate, ageDays] of [
    ["2026-01-01", 0],
    ["2026-01-07", 6],
  ] as const) {
    assert.deepEqual(feedAmountPresets("2026-01-01", recordDate, "formula"), {
      amounts: [15, 30, 45, 60],
      ageDays,
      ageAdjusted: true,
    });
  }
  for (const [recordDate, ageDays] of [
    ["2026-01-08", 7],
    ["2026-01-15", 14],
    ["2026-01-31", 30],
  ] as const) {
    assert.deepEqual(feedAmountPresets("2026-01-01", recordDate, "formula"), {
      amounts: [30, 60, 90, 120],
      ageDays,
      ageAdjusted: true,
    });
  }
});

test("formula shortcuts use calendar month boundaries rather than fixed day counts", () => {
  for (const [recordDate, ageDays] of [
    ["2026-02-01", 31],
    ["2026-06-30", 180],
  ] as const) {
    assert.deepEqual(feedAmountPresets("2026-01-01", recordDate, "formula"), {
      amounts: currentAmounts,
      ageDays,
      ageAdjusted: false,
    });
  }
  assert.deepEqual(feedAmountPresets("2026-01-01", "2026-07-01", "formula"), {
    amounts: [120, 150, 180, 240],
    ageDays: 181,
    ageAdjusted: true,
  });
  assert.deepEqual(feedAmountPresets("2026-01-01", "2026-12-31", "formula"), {
    amounts: [120, 150, 180, 240],
    ageDays: 364,
    ageAdjusted: true,
  });
  assert.deepEqual(feedAmountPresets("2026-01-01", "2027-01-01", "formula"), {
    amounts: currentAmounts,
    ageDays: 365,
    ageAdjusted: false,
  });
});

test("month anniversaries clamp to the final day of shorter months", () => {
  assert.deepEqual(feedAmountPresets("2026-01-31", "2026-02-27", "formula"), {
    amounts: [30, 60, 90, 120],
    ageDays: 27,
    ageAdjusted: true,
  });
  assert.deepEqual(feedAmountPresets("2026-01-31", "2026-02-28", "formula"), {
    amounts: currentAmounts,
    ageDays: 28,
    ageAdjusted: false,
  });
  assert.deepEqual(feedAmountPresets("2025-08-31", "2026-02-28", "formula"), {
    amounts: [120, 150, 180, 240],
    ageDays: 181,
    ageAdjusted: true,
  });
  assert.deepEqual(feedAmountPresets("2024-02-29", "2025-02-28", "formula"), {
    amounts: currentAmounts,
    ageDays: 365,
    ageAdjusted: false,
  });
});

test("historical feeds use age at the recorded feed date, not age today", () => {
  assert.deepEqual(feedAmountPresets("2020-01-01", "2020-01-15", "formula"), {
    amounts: [30, 60, 90, 120],
    ageDays: 14,
    ageAdjusted: true,
  });
});

test("calendar age is unaffected by daylight-saving changes", () => {
  for (const [birthDate, recordDate] of [
    ["2026-04-04", "2026-04-06"],
    ["2026-10-03", "2026-10-05"],
  ]) {
    assert.deepEqual(feedAmountPresets(birthDate, recordDate, "formula"), {
      amounts: [15, 30, 45, 60],
      ageDays: 2,
      ageAdjusted: true,
    });
  }
});

test("valid leap days contribute to calendar age", () => {
  assert.deepEqual(feedAmountPresets("2024-02-28", "2024-03-01", "formula"), {
    amounts: [15, 30, 45, 60],
    ageDays: 2,
    ageAdjusted: true,
  });
  assert.equal(
    feedAmountPresets("2000-02-29", "2000-03-01", "formula").ageDays,
    1,
  );
});

test("missing, invalid, noncanonical, and before-birth dates retain current shortcuts", () => {
  const fallback = {
    amounts: currentAmounts,
    ageDays: null,
    ageAdjusted: false,
  };
  for (const invalidDate of [
    "",
    "not-a-date",
    "2026-1-01",
    "2026-01-1",
    "2026-01-01T00:00:00Z",
    " 2026-01-01",
    "2026-01-01 ",
    "2026-00-01",
    "2026-13-01",
    "2026-01-00",
    "2026-01-32",
    "2026-04-31",
    "2025-02-29",
    "1900-02-29",
    "1899-12-31",
    "0099-01-01",
  ]) {
    assert.deepEqual(
      feedAmountPresets(invalidDate, "2026-01-15", "formula"),
      fallback,
      `Invalid birth date: ${invalidDate}`,
    );
    assert.deepEqual(
      feedAmountPresets("2026-01-01", invalidDate, "formula"),
      fallback,
      `Invalid record date: ${invalidDate}`,
    );
  }
  assert.deepEqual(
    feedAmountPresets("2026-01-15", "2026-01-14", "formula"),
    fallback,
  );
  assert.equal(
    feedAmountPresets("1900-01-01", "1900-01-02", "formula").ageDays,
    1,
  );
});

test("expressed milk and breastfeeding never use formula-specific shortcuts", () => {
  const nonFormulaKinds: Entry["feedKind"][] = [
    "expressed",
    "breast-left",
    "breast-right",
    "breast-both",
    undefined,
  ];
  for (const kind of nonFormulaKinds) {
    assert.deepEqual(feedAmountPresets("2026-01-01", "2026-01-15", kind), {
      amounts: currentAmounts,
      ageDays: null,
      ageAdjusted: false,
    });
  }
});
