import test from "node:test";
import assert from "node:assert/strict";
import { type Entry, validateEntry } from "./domain";
import { finishLiveSleep } from "./sleepTimer";

const running: Entry = {
  id: "sleep-timer",
  type: "sleep",
  start: "2026-09-17T02:00:00.000+10:00",
  note: "Keep this note",
};

test("live sleeps shorter than one minute are discarded, including immediate reversal", () => {
  for (const duration of [0, 1, 30_000, 59_999])
    assert.equal(
      finishLiveSleep(
        running,
        new Date(Date.parse(running.start) + duration).toISOString(),
      ),
      null,
    );
  assert.equal(running.end, undefined);
});

test("exactly one minute and longer live sleeps keep their original identity and precise times", () => {
  for (const duration of [60_000, 60_001, 7_200_000]) {
    const stop = new Date(Date.parse(running.start) + duration).toISOString();
    assert.deepEqual(finishLiveSleep(running, stop), {
      ...running,
      end: stop,
    });
  }
});

test("live sleep uses elapsed instants across midnight and daylight-saving changes", () => {
  assert.equal(
    finishLiveSleep(
      { ...running, start: "2026-09-16T23:59:45+10:00" },
      "2026-09-17T00:00:15+10:00",
    ),
    null,
  );
  assert.equal(
    finishLiveSleep(
      { ...running, start: "2026-10-04T01:59:30+10:00" },
      "2026-10-04T03:00:00+11:00",
    ),
    null,
  );
});

test("invalid, backwards and already completed timers are not silently discarded", () => {
  for (const stoppedAt of ["invalid", "2026-09-17T01:59:59+10:00"])
    assert.throws(() => finishLiveSleep(running, stoppedAt));
  assert.throws(() =>
    finishLiveSleep({ ...running, end: running.start }, running.start),
  );
  assert.throws(() =>
    finishLiveSleep({ ...running, type: "milestone" }, running.start),
  );
});

test("normal record validation still accepts short manually backfilled sleep", () => {
  const backfilled = { ...running, end: "2026-09-17T02:00:30+10:00" };
  assert.deepEqual(validateEntry(backfilled), backfilled);
});
