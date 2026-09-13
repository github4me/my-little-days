import type { Entry } from "./domain";

const currentAmounts = [60, 90, 120, 150] as const;

export const formulaFeedingSource =
  "https://www.healthychildren.org/English/ages-stages/baby/formula-feeding/Pages/amount-and-schedule-of-formula-feedings.aspx";

function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

// Recording shortcuts, not recommended doses. Never use these to replace an
// entered amount. The formula guidance does not establish expressed-milk doses.
// See docs/FEED-AMOUNT-PRESETS.md for sources and the choice of bands.
export function feedAmountPresets(
  birthDate: string,
  recordDate: string,
  feedKind: Entry["feedKind"],
): {
  amounts: readonly number[];
  ageDays: number | null;
  ageAdjusted: boolean;
} {
  const fallback = {
    amounts: currentAmounts,
    ageDays: null,
    ageAdjusted: false,
  };
  if (feedKind !== "formula") return fallback;
  const birth = calendarDate(birthDate);
  const recorded = calendarDate(recordDate);
  if (!birth || !recorded || recorded < birth) return fallback;

  // UTC calendar components avoid 23/25-hour days at daylight-saving changes.
  const ageDays = (recorded.getTime() - birth.getTime()) / 86400000;
  const anniversary = Math.min(
    birth.getUTCDate(),
    new Date(
      Date.UTC(recorded.getUTCFullYear(), recorded.getUTCMonth() + 1, 0),
    ).getUTCDate(),
  );
  const ageMonths =
    (recorded.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
    recorded.getUTCMonth() -
    birth.getUTCMonth() -
    (recorded.getUTCDate() < anniversary ? 1 : 0);

  const amounts =
    ageDays < 7
      ? [15, 30, 45, 60]
      : ageMonths < 1
        ? [30, 60, 90, 120]
        : ageMonths >= 6 && ageMonths < 12
          ? [120, 150, 180, 240]
          : currentAmounts;
  return { amounts, ageDays, ageAdjusted: amounts !== currentAmounts };
}
