import assert from "node:assert/strict";
import test from "node:test";
import { entryEditorDraftKey, type EntryEditorDraft } from "./entryEditorDraft";

const initial: EntryEditorDraft = {
  draft: {
    id: "fixture",
    type: "feed",
    start: "2026-09-26T09:00:00Z",
    feedKind: "formula",
    amount: 120,
    note: "",
  },
  start: { date: "2026-09-26", time: "09:00" },
  end: { date: "2026-09-26", time: "09:20" },
  hasEnd: false,
  amount: "120",
  weight: "",
  length: "",
  head: "",
};

test("draft identity ignores unedited defaults, hidden end fields and property order", () => {
  assert.equal(
    entryEditorDraftKey(initial),
    entryEditorDraftKey({ ...initial, end: { date: "", time: "" } }),
  );
  assert.equal(
    entryEditorDraftKey(initial),
    entryEditorDraftKey({
      ...initial,
      draft: { ...initial.draft, amount: 120 },
    }),
  );
  assert.equal(
    entryEditorDraftKey(initial),
    entryEditorDraftKey({ ...initial, weight: "not visible" }),
  );
});

test("draft protection covers amount, notes, feeding method, date, time and optional end", () => {
  const variants: EntryEditorDraft[] = [
    { ...initial, amount: "137" },
    { ...initial, amount: "" },
    { ...initial, draft: { ...initial.draft, note: "changed" } },
    { ...initial, draft: { ...initial.draft, feedKind: "expressed" } },
    { ...initial, start: { ...initial.start, date: "2026-" } },
    { ...initial, start: { ...initial.start, time: "invalid" } },
    { ...initial, hasEnd: true },
  ];
  for (const value of variants)
    assert.notEqual(entryEditorDraftKey(value), entryEditorDraftKey(initial));
  const completed = { ...initial, hasEnd: true };
  assert.notEqual(
    entryEditorDraftKey(completed),
    entryEditorDraftKey({
      ...completed,
      end: { ...completed.end, time: "09:21" },
    }),
  );
  assert.equal(
    entryEditorDraftKey({ ...initial, amount: "137" }),
    entryEditorDraftKey({ ...initial, amount: "137" }),
  );
});

test("growth, sleep, diaper and milestone drafts also retain their editable fields", () => {
  for (const type of ["growth", "sleep", "diaper", "milestone"] as const) {
    const base = { ...initial, draft: { ...initial.draft, type } };
    const changed =
      type === "growth"
        ? { ...base, weight: "7," }
        : type === "sleep"
          ? { ...base, hasEnd: true }
          : type === "diaper"
            ? {
                ...base,
                draft: { ...base.draft, diaperKind: "dirty" as const },
              }
            : { ...base, draft: { ...base.draft, title: "First smile" } };
    assert.notEqual(
      entryEditorDraftKey(base),
      entryEditorDraftKey(changed),
      type,
    );
  }
});
