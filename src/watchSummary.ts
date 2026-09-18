import type { Entry } from "./domain";

// A bounded union lets the Watch add local completed sleep without double
// counting overlaps with backfilled phone records. No notes or record IDs cross.
export function watchSleepRanges(
  entries: Entry[],
  from: Date,
  to: Date,
): [number, number][] | undefined {
  const ranges = entries
    .filter((entry) => entry.type === "sleep" && entry.end)
    .map((entry): [number, number] => [
      Math.max(from.getTime(), Date.parse(entry.start)) / 1000,
      Math.min(to.getTime(), Date.parse(entry.end!)) / 1000,
    ])
    .filter(
      ([start, end]) =>
        Number.isFinite(start) && Number.isFinite(end) && end > start,
    )
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  // Keep the existing 32 KiB Watch envelope bound. With pathological histories
  // sleep remains the confirmed phone total; feed/nappy local updates still work.
  return merged.length <= 512 ? merged : undefined;
}
