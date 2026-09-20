import test from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  validateState,
  validateEntry,
  summarize,
  ageLabel,
  type Entry,
} from "./domain";
const feed: Entry = {
  id: "feed-1",
  type: "feed",
  start: "2026-09-06T19:45:00+10:00",
  feedKind: "formula",
  amount: 120,
  note: "",
};
test("feed timers persist without activating legacy records and reject conflicting states", () => {
  const running = validateEntry({ ...feed, feedRunning: true });
  assert.equal(validateEntry(feed).feedRunning, undefined);
  assert.equal(
    validateState(
      JSON.parse(JSON.stringify({ ...initialState, entries: [running] })),
    ).entries[0].feedRunning,
    true,
  );
  assert.throws(() =>
    validateEntry({ ...running, end: "2026-09-06T20:00:00+10:00" }),
  );
  assert.throws(() => validateEntry({ ...feed, feedRunning: "true" }));
  assert.throws(() =>
    validateState({
      ...initialState,
      entries: [running, { ...running, id: "second" }],
    }),
  );
  const { feedRunning, ...finished } = running;
  assert.equal(
    validateEntry({ ...finished, end: "2026-09-06T20:00:00+10:00" })
      .feedRunning,
    undefined,
  );
});
test("running sleep and feed timers are independent while same-kind duplicates remain invalid", () => {
  const runningFeed = validateEntry({ ...feed, feedRunning: true });
  const runningSleep: Entry = {
    id: "sleep-1",
    type: "sleep",
    start: feed.start,
    note: "",
  };
  const concurrent = validateState({
    ...initialState,
    entries: [runningSleep, runningFeed],
  });
  assert.deepEqual(concurrent.entries, [runningSleep, runningFeed]);
  assert.throws(
    () =>
      validateState({
        ...initialState,
        entries: [runningSleep, { ...runningSleep, id: "sleep-2" }],
      }),
    /只能有一个进行中的睡眠/,
  );
  assert.throws(
    () =>
      validateState({
        ...initialState,
        entries: [runningFeed, { ...runningFeed, id: "feed-2" }],
      }),
    /请先停止正在进行的喂养/,
  );
});
test("backup round-trip validates and returns detached data", () => {
  const state = {
    ...initialState,
    profile: { name: "宝宝", birthDate: "2026-07-01", sex: "male" },
    entries: [feed],
  };
  const result = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(result, state);
  assert.notEqual(result.entries[0], feed);
  assert.deepEqual(validateState(initialState), initialState);
});
test("reject corrupted backups without accepting partial records", () => {
  for (const input of [
    null,
    {},
    { ...initialState, schemaVersion: 2 },
    { ...initialState, entries: [feed, feed] },
    {
      ...initialState,
      profile: { ...initialState.profile, birthDate: "2026-02-30" },
    },
    { ...initialState, entries: [{ ...feed, amount: -1 }] },
  ])
    assert.throws(() => validateState(input));
  const sleep = { id: "s1", type: "sleep", start: feed.start, note: "" };
  assert.throws(() =>
    validateState({
      ...initialState,
      entries: [sleep, { ...sleep, id: "s2" }],
    }),
  );
});
test("reject invalid numeric, calendar, type-specific and interval fields", () => {
  for (const amount of [NaN, Infinity, -1, 2001, "120"])
    assert.throws(() => validateEntry({ ...feed, amount }));
  for (const start of [
    "2026-02-30T10:00:00Z",
    "2026-09-06",
    "2026-09-06T24:00:00Z",
  ])
    assert.throws(() => validateEntry({ ...feed, start }));
  assert.throws(() => validateEntry({ ...feed, feedKind: "breast-left" }));
  assert.throws(() => validateEntry({ ...feed, end: "2026-09-05T10:00:00Z" }));
  assert.throws(() =>
    validateEntry({ id: "g", type: "growth", start: feed.start, note: "" }),
  );
  assert.throws(() => validateEntry({ ...feed, weight: 5 }));
});
test("sleep crossing midnight is clipped to each day", () => {
  const sleep: Entry = {
    id: "s",
    type: "sleep",
    start: "2026-09-06T23:00:00+10:00",
    end: "2026-09-07T02:30:00+10:00",
    note: "",
  };
  assert.equal(
    summarize(
      [sleep],
      new Date("2026-09-06T00:00:00+10:00"),
      new Date("2026-09-07T00:00:00+10:00"),
    ).sleepMinutes,
    60,
  );
  assert.equal(
    summarize(
      [sleep],
      new Date("2026-09-07T00:00:00+10:00"),
      new Date("2026-09-08T00:00:00+10:00"),
    ).sleepMinutes,
    150,
  );
});
test("DST sleep counts elapsed time, not local clock subtraction", () => {
  const sleep: Entry = {
    id: "s",
    type: "sleep",
    start: "2026-10-04T01:30:00+10:00",
    end: "2026-10-04T03:30:00+11:00",
    note: "",
  };
  assert.equal(
    summarize(
      [sleep],
      new Date("2026-10-04T00:00:00+10:00"),
      new Date("2026-10-05T00:00:00+11:00"),
    ).sleepMinutes,
    60,
  );
});
test("mixed diaper is one change, with both wet and dirty counts; upper bound exclusive", () => {
  const mixed: Entry = {
    id: "d",
    type: "diaper",
    diaperKind: "mixed",
    start: feed.start,
    note: "",
  };
  const result = summarize(
    [feed, mixed, { ...feed, id: "f2", start: "2026-09-07T00:00:00+10:00" }],
    new Date("2026-09-06T00:00:00+10:00"),
    new Date("2026-09-07T00:00:00+10:00"),
  );
  assert.deepEqual(result, {
    feedMl: 120,
    feedCount: 1,
    sleepMinutes: 0,
    diaperCount: 1,
    wetCount: 1,
    dirtyCount: 1,
  });
});
test("age uses local calendar days", () => {
  assert.equal(ageLabel("2026-07-01", new Date(2026, 6, 9, 1)), "8天 · 1周1天");
  assert.equal(ageLabel("", new Date()), "设置出生日期");
});
test("overlapping and nested sleeps count union of time; unfinished sleep excluded", () => {
  const sleep = (id: string, start: string, end?: string): Entry => ({
    id,
    type: "sleep",
    start: `2026-09-06T${start}:00Z`,
    ...(end ? { end: `2026-09-06T${end}:00Z` } : {}),
    note: "",
  });
  const entries = [
    sleep("1", "01:00", "03:00"),
    sleep("2", "02:00", "04:00"),
    sleep("3", "02:30", "02:45"),
    sleep("4", "05:00", "06:00"),
    sleep("5", "06:00"),
  ];
  assert.equal(
    summarize(
      entries,
      new Date("2026-09-06T00:00:00Z"),
      new Date("2026-09-07T00:00:00Z"),
    ).sleepMinutes,
    240,
  );
});
