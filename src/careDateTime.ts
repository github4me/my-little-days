export type CarePickerMode = "date" | "time";

// Native time pickers (notably Android) do not all enforce date limits.
// Keep the draft at minute precision, within the same bounds as careTime.
export function boundedCarePickerDate(
  value: Date,
  now: number,
  birthDate: string,
): Date {
  const maximum = Math.floor(now / 60_000) * 60_000;
  const birth = Date.parse(`${birthDate}T00:00:00`);
  const minimum = Number.isFinite(birth) ? Math.min(birth, maximum) : -Infinity;
  const timestamp = Number.isFinite(value.getTime())
    ? Math.floor(value.getTime() / 60_000) * 60_000
    : maximum;
  return new Date(Math.min(maximum, Math.max(minimum, timestamp)));
}

export function updateCarePickerDate(
  current: Date,
  selected: Date,
  mode: CarePickerMode,
  now: number,
  birthDate: string,
): Date {
  const next = new Date(current);
  if (mode === "date") {
    next.setFullYear(
      selected.getFullYear(),
      selected.getMonth(),
      selected.getDate(),
    );
  } else {
    // A time-only picker may return today's date even when editing an old
    // record. Preserve the record's selected day, not the picker event's day.
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  }
  return boundedCarePickerDate(next, now, birthDate);
}
