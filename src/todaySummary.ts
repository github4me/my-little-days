import { summarize, type Entry } from "./domain";

// Phone and widget snapshots share the same day boundary and live-sleep rule.
// Never extend ongoing sleep beyond the instant this local summary was made.
export function summarizeToday(entries: Entry[], now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return summarize(
    entries.map((entry) =>
      entry.type === "sleep" && !entry.end
        ? { ...entry, end: now.toISOString() }
        : entry,
    ),
    today,
    tomorrow,
  );
}
