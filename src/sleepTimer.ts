import { type Entry, validateEntry } from "./domain";

// Only the live Sleep/Awake controls use this rule. Backfilled records retain
// their exact duration and are validated through the normal editor path.
export function finishLiveSleep(entry: Entry, stoppedAt: string): Entry | null {
  if (entry.type !== "sleep" || entry.end) throw new Error("睡眠计时状态无效");
  const finished = validateEntry({ ...entry, end: stoppedAt });
  return Date.parse(finished.end!) - Date.parse(finished.start) < 60_000
    ? null
    : finished;
}
