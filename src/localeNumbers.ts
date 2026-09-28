export function formatEditableNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    useGrouping: false,
    // A reopened record must retain the exact stored number even when the
    // user edits only another field. Twenty-one significant digits cover a
    // JavaScript number's round-trip representation while avoiding exponent
    // notation that decimal keyboards cannot edit.
    maximumSignificantDigits: 21,
  }).format(value);
}

export function formatDisplayNumber(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions = {},
) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 3,
    ...options,
  }).format(value);
}

/**
 * Parse a user-entered decimal without forcing a keyboard's separator to
 * match the selected locale. Both `.` and `,` are accepted as the sole
 * decimal separator; when both occur, the last one is treated as decimal and
 * the other as grouping.
 */
export function parseLocalizedNumber(value: string, _locale: string) {
  const input = value.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!input) return Number.NaN;

  const separators = [".", ","].filter((separator) =>
    input.includes(separator),
  );
  let normalized = input.replace(/[−﹣－]/g, "-");

  if (separators.length === 2) {
    const decimalSeparator =
      input.lastIndexOf(".") > input.lastIndexOf(",") ? "." : ",";
    const groupingSeparator = decimalSeparator === "." ? "," : ".";
    normalized = normalized
      .replaceAll(groupingSeparator, "")
      .replace(decimalSeparator, ".");
  } else if (separators.length === 1) {
    const separator = separators[0];
    const occurrences = normalized.split(separator).length - 1;
    if (occurrences === 1) {
      // A single separator is accepted as decimal even when it differs from
      // the selected locale; iOS decimal keyboards are not consistent here.
      normalized = normalized.replace(separator, ".");
    } else {
      return Number.NaN;
    }
  }

  return /^[-+]?\d+(?:\.\d+)?$/.test(normalized)
    ? Number(normalized)
    : Number.NaN;
}
