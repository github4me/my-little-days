import type { Entry } from "./domain";

export type EntryEditorDraft = {
  draft: Entry;
  start: { date: string; time: string };
  end: { date: string; time: string };
  hasEnd: boolean;
  amount: string;
  weight: string;
  length: string;
  head: string;
};

/** Compare editable raw fields without parsing incomplete dates or numbers. */
export function entryEditorDraftKey(value: EntryEditorDraft): string {
  const { draft, start, end, hasEnd } = value;
  const bottle = draft.feedKind === "formula" || draft.feedKind === "expressed";
  const timed = draft.type === "feed" || draft.type === "sleep";
  return JSON.stringify([
    draft.type,
    start.date,
    start.time,
    draft.note,
    draft.type === "milestone" ? (draft.title ?? "") : null,
    draft.type === "feed" ? draft.feedKind : null,
    draft.type === "diaper" ? draft.diaperKind : null,
    timed && hasEnd,
    timed && hasEnd ? [end.date, end.time] : null,
    draft.type === "feed" && bottle ? value.amount : null,
    draft.type === "growth" ? [value.weight, value.length, value.head] : null,
  ]);
}
