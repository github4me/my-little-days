export function chartFontFamily(platform: string): string {
  return platform === "web"
    ? "system-ui"
    : platform === "android"
      ? "sans-serif"
      : "System";
}

/** Stagger close value labels without changing bar positions or values. */
export function layoutBarValueLabels(
  input: readonly { x: number; y: number; text: string }[],
  width: number,
  fontSize: number,
) {
  const labels: {
    index: number;
    x: number;
    y: number;
    text: string;
    width: number;
  }[] = [];
  const lineHeight = fontSize * 1.6 + 4;
  for (const [index, point] of input.entries()) {
    const textWidth = Array.from(point.text).reduce(
      (sum, char) =>
        sum +
        (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(
          char,
        )
          ? 1.05
          : 0.8) *
          fontSize,
      8,
    );
    const x = Math.max(
      textWidth / 2 + 4,
      Math.min(width - textWidth / 2 - 4, point.x),
    );
    let y = point.y;
    while (
      labels.some(
        (other) =>
          Math.abs(other.x - x) < (other.width + textWidth) / 2 + 4 &&
          Math.abs(other.y - y) < lineHeight,
      )
    )
      y -= lineHeight;
    labels.push({ index, x, y, text: point.text, width: textWidth });
  }
  const topInset = Math.max(
    0,
    ...labels.map((label) => fontSize + 8 - label.y),
  );
  return {
    topInset,
    labels: labels.map((label) => ({ ...label, y: label.y + topInset })),
  };
}

/** SVG text does not scale automatically. Grow geometry as well as the type. */
export function chartAxisLayout({
  width,
  fontScale,
  compact = false,
  leftLabelChars = 5,
  xLabelChars = 5,
  xLabelCount = 4,
}: {
  width: number;
  fontScale: number;
  compact?: boolean;
  leftLabelChars?: number;
  xLabelChars?: number;
  xLabelCount?: number;
}) {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const fontSize = 12 * Math.max(1, scale);
  const labelWidth = fontSize * Math.max(1, xLabelChars) * 0.8;
  const left = Math.max(
    labelWidth / 2 + 12,
    fontSize * leftLabelChars * 0.8 + 16,
  );
  const right = labelWidth / 2 + 12;
  const canvasWidth = Math.max(
    Number.isFinite(width) && width > 0 ? width : 280,
    left + right + Math.max(1, xLabelCount - 1) * (labelWidth + 12),
  );
  const top = fontSize * 1.6 + 8;
  const plotHeight = Math.max(compact ? 82 : 135, fontSize * 4.5);
  const baseline = top + plotHeight;
  const axisLabelY = baseline + fontSize + 14;
  return {
    width: canvasWidth,
    fontSize,
    left,
    right,
    top,
    baseline,
    plotWidth: canvasWidth - left - right,
    plotHeight,
    axisLabelY,
    height: axisLabelY + fontSize + 12,
  };
}
