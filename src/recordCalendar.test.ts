import test from "node:test";
import assert from "node:assert/strict";
import type { Entry } from "./domain";
import {
  calendarItems,
  calendarWeek,
  parseCalendarDay,
  parseRecordView,
  shiftCalendarDay,
} from "./recordCalendar";

process.env.TZ = "Australia/Sydney";
const day = new Date(2026, 8, 13);
const now = new Date(2026, 8, 14).getTime();
const iso = (date: Date) => date.toISOString();
const event = (
  id: string,
  start: Date,
  end?: Date,
  type: Entry["type"] = "sleep",
): Entry => ({
  id,
  type,
  start: iso(start),
  ...(end ? { end: iso(end) } : {}),
  note: "",
});

test("calendar splits midnight intervals without changing their records", () => {
  const sleep = event(
    "sleep",
    new Date(2026, 8, 12, 23),
    new Date(2026, 8, 13, 2),
  );
  const feed = {
    ...event(
      "feed",
      new Date(2026, 8, 12, 23, 50),
      new Date(2026, 8, 13, 0, 10),
      "feed",
    ),
    amount: 60,
  };
  const current = calendarItems([sleep, feed], day, now).items;
  assert.equal(current.length, 2);
  assert.equal(
    current.find((item) => item.entry.id === "sleep")?.endMinute,
    120,
  );
  assert.equal(current.find((item) => item.entry.id === "feed")?.endMinute, 10);
  assert.ok(
    current.every((item) => item.startMinute === 0 && item.continuesBefore),
  );
  const previous = calendarItems(
    [sleep, feed],
    shiftCalendarDay(day, -1),
    now,
  ).items;
  assert.ok(previous.every((item) => item.continuesAfter));
  assert.equal(
    previous.find((item) => item.entry.id === "sleep")!.entry,
    sleep,
  );
  assert.equal(
    calendarItems(
      [event("ends-midnight", shiftCalendarDay(day, -1), day)],
      day,
      now,
    ).items.length,
    0,
  );
});

test("overlapping records stay distinct and receive nonoverlapping visual lanes", () => {
  const records = [
    event("long", new Date(2026, 8, 13, 1), new Date(2026, 8, 13, 5)),
    event("nested", new Date(2026, 8, 13, 2), new Date(2026, 8, 13, 3)),
    event("point", new Date(2026, 8, 13, 2, 15), undefined, "diaper"),
    event("later", new Date(2026, 8, 13, 4), new Date(2026, 8, 13, 4, 30)),
    event("separate", new Date(2026, 8, 13, 8), new Date(2026, 8, 13, 9)),
  ];
  const { items } = calendarItems(records, day, now);
  assert.equal(items.length, records.length);
  for (const a of items)
    for (const b of items) {
      if (a !== b && a.visualStart < b.visualEnd && b.visualStart < a.visualEnd)
        assert.notEqual(a.lane, b.lane);
    }
  assert.equal(items.find((item) => item.entry.id === "long")!.laneCount, 3);
  assert.equal(
    items.find((item) => item.entry.id === "separate")!.laneCount,
    1,
  );
  assert.deepEqual(
    calendarItems([...records].reverse(), day, now).items,
    items,
  );
});

test("point records at day edges retain exact time and usable visual size", () => {
  const records = [
    event("first", day, undefined, "diaper"),
    event("last", new Date(2026, 8, 13, 23, 59), undefined, "feed"),
    event("tomorrow", shiftCalendarDay(day, 1), undefined, "diaper"),
  ];
  const { items } = calendarItems(records, day, now);
  assert.equal(items.length, 2);
  const last = items.find((item) => item.entry.id === "last")!;
  assert.equal(last.startMinute, 1439);
  assert.equal(last.endMinute, 1439);
  assert.equal(last.visualEnd - last.visualStart, 44);
  assert.ok(
    items.every((item) => item.visualStart >= 0 && item.visualEnd <= 1440),
  );
});

test("running sessions stop at now; legacy feeds without end times stay points", () => {
  const runningNow = new Date(2026, 8, 13, 10, 30).getTime();
  const records = [
    event("sleep", new Date(2026, 8, 13, 10)),
    {
      ...event("feed", new Date(2026, 8, 13, 10), undefined, "feed"),
      feedRunning: true as const,
    },
    event("legacy", new Date(2026, 8, 13, 9), undefined, "feed"),
  ];
  const { items } = calendarItems(records, day, runningNow);
  assert.equal(items.filter((item) => item.running).length, 2);
  assert.ok(
    items
      .filter((item) => item.running)
      .every((item) => item.endMinute === 630),
  );
  assert.ok(items.find((item) => item.entry.id === "legacy")!.point);
  assert.equal(calendarItems(records, day, runningNow, "feed").items.length, 2);
  assert.equal(
    calendarItems(records, day, runningNow, "diaper").items.length,
    0,
  );
});

test("DST preserves elapsed duration and both occurrences of repeated local time", () => {
  const autumn = new Date(2026, 3, 5);
  const first = event(
    "first",
    new Date("2026-04-05T02:10:00+11:00"),
    new Date("2026-04-05T02:40:00+11:00"),
  );
  const second = event(
    "second",
    new Date("2026-04-05T02:10:00+10:00"),
    new Date("2026-04-05T02:40:00+10:00"),
  );
  const { items, dayMinutes } = calendarItems([first, second], autumn, now);
  assert.equal(dayMinutes, 1500);
  assert.equal(items[1].startMinute - items[0].startMinute, 60);
  assert.ok(items.every((item) => item.endMinute - item.startMinute === 30));
  const spring = new Date(2026, 9, 4);
  const across = event(
    "spring",
    new Date("2026-10-04T01:30:00+10:00"),
    new Date("2026-10-04T03:30:00+11:00"),
  );
  const result = calendarItems(
    [across],
    spring,
    new Date(2026, 9, 5).getTime(),
  );
  assert.equal(result.dayMinutes, 1380);
  assert.equal(result.items[0].endMinute - result.items[0].startMinute, 60);
});

test("calendar date navigation validates dates and weeks across year boundaries", () => {
  for (const value of [
    "",
    "2026-2-03",
    "2026-02-30",
    "2025-02-29",
    "0099-01-01",
  ])
    assert.equal(parseCalendarDay(value), null);
  assert.ok(parseCalendarDay("2024-02-29"));
  const week = calendarWeek(new Date(2026, 0, 1));
  assert.equal(week.length, 7);
  assert.equal(week[0].getDay(), 1);
  assert.equal(week[0].getFullYear(), 2025);
  assert.equal(week[6].getDay(), 0);
  assert.equal(parseRecordView(undefined), "calendar");
  assert.equal(parseRecordView("bars"), "bars");
  assert.equal(parseRecordView("broken"), "calendar");
});
