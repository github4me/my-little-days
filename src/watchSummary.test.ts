import assert from "node:assert/strict";
import test from "node:test";
import type { Entry } from "./domain";
import { watchSleepRanges } from "./watchSummary";

const from = new Date("2026-09-19T00:00:00Z");
const to = new Date("2026-09-20T00:00:00Z");
const sleep = (start: string, end?: string): Entry => ({
  id: start,
  type: "sleep",
  start,
  ...(end ? { end } : {}),
  note: "",
});

test("Watch summary clips completed sleep to the day and unions overlaps", () => {
  assert.deepEqual(
    watchSleepRanges(
      [
        sleep("2026-09-18T23:00:00Z", "2026-09-19T00:30:00Z"),
        sleep("2026-09-19T00:20:00Z", "2026-09-19T01:00:00Z"),
        sleep("2026-09-19T00:25:00Z", "2026-09-19T00:40:00Z"),
        sleep("2026-09-19T12:00:00Z"),
        sleep("2026-09-19T23:50:00Z", "2026-09-20T01:00:00Z"),
      ],
      from,
      to,
    ),
    [
      [+from / 1000, +from / 1000 + 3600],
      [+to / 1000 - 600, +to / 1000],
    ],
  );
});

test("Watch metadata stays bounded for large histories", () => {
  const rows = Array.from({ length: 513 }, (_, i) =>
    sleep(
      new Date(+from + i * 120000).toISOString(),
      new Date(+from + i * 120000 + 60000).toISOString(),
    ),
  );
  assert.equal(watchSleepRanges(rows, from, to), undefined);
  assert.equal(watchSleepRanges(rows.slice(0, 512), from, to)?.length, 512);
  assert.deepEqual(watchSleepRanges(Array(10000).fill(rows[0]), from, to), [
    [+from / 1000, +from / 1000 + 60],
  ]);
  assert.deepEqual(watchSleepRanges([], from, to), []);
});
