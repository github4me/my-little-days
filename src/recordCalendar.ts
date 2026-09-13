import type { Entry } from "./domain";

export type RecordView = "bars" | "calendar";
export type CalendarKind = "all" | "feed" | "diaper" | "sleep";
export function parseRecordView(value: unknown): RecordView {
  return value === "bars" ? "bars" : "calendar";
}
export const calendarDayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function parseCalendarDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return year >= 1900 && calendarDayKey(date) === value ? date : null;
}
export function shiftCalendarDay(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
export function calendarWeek(date: Date): Date[] {
  const monday = shiftCalendarDay(date, -((date.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) =>
    shiftCalendarDay(monday, index),
  );
}
export type CalendarItem = {
  entry: Entry;
  startMinute: number;
  endMinute: number;
  visualStart: number;
  visualEnd: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  running: boolean;
  point: boolean;
  lane: number;
  laneCount: number;
};

// Positions use elapsed minutes in a local calendar day, including 23/25-hour
// clock-change days. The visual minimum affects touch size only, never totals.
export function calendarItems(
  entries: Entry[],
  date: Date,
  now: number,
  kind: CalendarKind = "all",
  minimumMinutes = 44,
): { items: CalendarItem[]; dayMinutes: number } {
  const from = shiftCalendarDay(date, 0).getTime();
  const until = shiftCalendarDay(date, 1).getTime();
  const dayMinutes = (until - from) / 60000;
  const items: CalendarItem[] = [];
  for (const entry of entries) {
    if (
      !["feed", "diaper", "sleep"].includes(entry.type) ||
      (kind !== "all" && entry.type !== kind)
    )
      continue;
    const start = Date.parse(entry.start);
    const running =
      (entry.type === "sleep" && !entry.end) || entry.feedRunning === true;
    const finish = entry.end ? Date.parse(entry.end) : running ? now : start;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(finish) ||
      start > now ||
      finish < start
    )
      continue;
    const point = finish === start;
    if (
      point ? start < from || start >= until : finish <= from || start >= until
    )
      continue;
    const startMinute = (Math.max(start, from) - from) / 60000;
    const endMinute = (Math.min(finish, until) - from) / 60000;
    const visualStart = Math.min(
      startMinute,
      Math.max(0, dayMinutes - minimumMinutes),
    );
    items.push({
      entry,
      startMinute,
      endMinute,
      visualStart,
      visualEnd: Math.min(
        dayMinutes,
        Math.max(endMinute, visualStart + minimumMinutes),
      ),
      continuesBefore: start < from,
      continuesAfter: finish > until,
      running,
      point,
      lane: 0,
      laneCount: 1,
    });
  }
  items.sort(
    (a, b) =>
      a.visualStart - b.visualStart ||
      b.visualEnd - a.visualEnd ||
      a.entry.id.localeCompare(b.entry.id),
  );
  let cluster: CalendarItem[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  function finishCluster() {
    for (const item of cluster) item.laneCount = laneEnds.length;
    cluster = [];
    laneEnds = [];
  }
  for (const item of items) {
    if (item.visualStart >= clusterEnd) finishCluster();
    let lane = laneEnds.findIndex((end) => end <= item.visualStart);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = item.visualEnd;
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.visualEnd);
  }
  finishCluster();
  return { items, dayMinutes };
}
