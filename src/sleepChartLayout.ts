export type SleepChartInput = {
  /** Local clock hour; a bar's width does not represent elapsed time. */
  x: number;
  /** Actual duration in hours. */
  value: number;
  label: string;
};

export type SleepChartBar = {
  index: number;
  x: number;
  anchorX: number;
  width: number;
  height: number;
  value: number;
  displayValue: number;
  compressed: boolean;
  clustered: boolean;
  variant: number;
  label: string;
  labelX: number;
  /** SVG text baseline, not the top of its bounding box. */
  labelY: number;
  labelWidth: number;
};

type Box = { left: number; right: number; top: number; bottom: number };

export const SLEEP_CHART_INSET = 16;
const padding = SLEEP_CHART_INSET;
const barGap = 2;
const plotHeight = 90;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function labelWidth(label: string, fontSize: number): number {
  // SVG does not expose synchronous text measurement across native and web.
  // Leave additional room beyond typical system-font advances, including CJK.
  let units = 0;
  for (const char of label) {
    if (
      /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(
        char,
      )
    )
      units += 1.05;
    else if (/\s/u.test(char)) units += 0.35;
    else if (/[ilI.,:;!|'`]/u.test(char)) units += 0.36;
    else if (/[MW@]/u.test(char)) units += 0.95;
    else if (/\p{Mark}/u.test(char)) units += 0;
    else units += 0.7;
  }
  return Math.max(fontSize, units * fontSize + 8);
}

function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

/**
 * Pure display geometry. Durations, labels, order and record identity are not
 * changed by visual compression or by packing bars around their clock anchors.
 */
export function layoutSleepChart(
  input: readonly SleepChartInput[],
  options: { width: number; fontSize: number },
): {
  bars: SleepChartBar[];
  width: number;
  height: number;
  baseline: number;
  plotTop: number;
  compressed: boolean;
  clustered: boolean;
} {
  const fontSize = Number.isFinite(options.fontSize)
    ? clamp(options.fontSize, 8, 96)
    : 12;
  const measured = input.map((bar) => labelWidth(bar.label, fontSize));
  const requestedWidth = Number.isFinite(options.width)
    ? clamp(options.width, 160, 10000)
    : 330;
  // Keep every annotation and at least a 4pt bar plus its gap within the canvas.
  const width = Math.max(
    requestedWidth,
    measured.reduce((max, value) => Math.max(max, value), 0) + padding * 2,
    input.length * (4 + barGap) - barGap + padding * 2,
  );
  const plotWidth = width - padding * 2;
  const values = input.map((bar) =>
    Number.isFinite(bar.value) && bar.value > 0 ? bar.value : 0,
  );
  const positive = values.filter((value) => value > 0).sort((a, b) => a - b);
  const middle = Math.floor(positive.length / 2);
  const median =
    positive.length % 2
      ? (positive[middle] ?? 0)
      : (positive[middle - 1] ?? 0) / 2 + (positive[middle] ?? 0) / 2;
  const threshold = median * 2.5;
  const typical = positive.filter((value) => value <= threshold);
  const mayCompress = positive.length >= 3 && typical.length >= 2;
  // Divide before summing to avoid overflow on malformed but finite durations.
  const typicalMean = typical.reduce(
    (sum, value) => sum + value / typical.length,
    0,
  );
  const displayValues = values.map((value) =>
    mayCompress && value > threshold ? typicalMean : value,
  );
  const max =
    displayValues.reduce((largest, value) => Math.max(largest, value), 0) || 1;
  const barWidth = Math.min(
    18,
    (plotWidth - barGap * Math.max(0, input.length - 1)) /
      Math.max(1, input.length),
  );
  const separation = barWidth + barGap;
  const sorted = input
    .map((bar, index) => ({
      index,
      anchorX:
        padding +
        (clamp(Number.isFinite(bar.x) ? bar.x : 0, 0, 24) / 24) * plotWidth,
    }))
    .sort((a, b) => a.anchorX - b.anchorX || a.index - b.index);

  // Isotonic packing minimizes movement from the true clock positions while
  // enforcing separation. Unlike a forward-only pass, equal starts stay centred.
  const blocks: { start: number; end: number; total: number; count: number }[] =
    [];
  sorted.forEach((bar, index) => {
    blocks.push({
      start: index,
      end: index,
      total: bar.anchorX - index * separation,
      count: 1,
    });
    while (blocks.length > 1) {
      const previous = blocks[blocks.length - 2];
      const current = blocks[blocks.length - 1];
      if (previous.total / previous.count <= current.total / current.count)
        break;
      previous.end = current.end;
      previous.total += current.total;
      previous.count += current.count;
      blocks.pop();
    }
  });
  const minCenter = padding + barWidth / 2;
  const maxOffset =
    width - padding - barWidth / 2 - Math.max(0, input.length - 1) * separation;
  const offsets: number[] = [];
  for (const block of blocks) {
    const offset = clamp(block.total / block.count, minCenter, maxOffset);
    for (let index = block.start; index <= block.end; index++)
      offsets[index] = offset;
  }
  const bars: SleepChartBar[] = input.map((bar, index) => ({
    index,
    x: 0,
    anchorX: 0,
    width: barWidth,
    height: (displayValues[index] / max) * plotHeight,
    value: values[index],
    displayValue: displayValues[index],
    compressed: displayValues[index] !== values[index],
    clustered: false,
    variant: 0,
    label: bar.label,
    labelX: 0,
    labelY: 0,
    labelWidth: measured[index],
  }));
  sorted.forEach((bar, index) => {
    bars[bar.index].x = offsets[index] + index * separation;
    bars[bar.index].anchorX = bar.anchorX;
  });
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (
      end < sorted.length &&
      Math.abs(offsets[end] - offsets[start]) < 0.01
    )
      end++;
    if (end - start > 1)
      for (let index = start; index < end; index++) {
        const bar = bars[sorted[index].index];
        bar.clustered = true;
        bar.variant = (index - start) % 2;
      }
    start = end;
  }

  const labelDescent = Math.max(4, fontSize * 0.3);
  const labelGap = labelDescent + 5;
  let plotTop = Math.max(28, fontSize + labelGap + 12);
  let baseline = plotTop + plotHeight;
  const labelBoxes = bars.map((bar) => {
    bar.labelX = clamp(
      bar.x,
      padding + bar.labelWidth / 2,
      width - padding - bar.labelWidth / 2,
    );
    bar.labelY = baseline - bar.height - labelGap;
    return {
      left: bar.labelX - bar.labelWidth / 2 - 3,
      right: bar.labelX + bar.labelWidth / 2 + 3,
      top: bar.labelY - fontSize,
      bottom: bar.labelY + labelDescent,
    };
  });
  const barBoxes = bars.map((bar) => ({
    left: bar.x - bar.width / 2,
    right: bar.x + bar.width / 2,
    top: baseline - bar.height,
    bottom: baseline,
  }));
  const crowded =
    bars.some((bar) => bar.clustered) ||
    labelBoxes.some(
      (box, index) =>
        labelBoxes.some(
          (other, otherIndex) =>
            otherIndex !== index && boxesOverlap(box, other),
        ) ||
        barBoxes.some(
          (other, otherIndex) =>
            otherIndex !== index && boxesOverlap(box, other),
        ),
    );
  if (crowded) {
    const rows: { left: number; right: number }[][] = [];
    const barRows = new Map<number, number>();
    for (const { index } of sorted) {
      const box = labelBoxes[index];
      let row = rows.findIndex((boxes) =>
        boxes.every(
          (other) => box.right <= other.left || other.right <= box.left,
        ),
      );
      if (row < 0) {
        row = rows.length;
        rows.push([]);
      }
      rows[row].push({ left: box.left, right: box.right });
      barRows.set(index, row);
    }
    const rowHeight = fontSize + labelDescent + 8;
    plotTop = 12 + rows.length * rowHeight + 8;
    baseline = plotTop + plotHeight;
    for (const bar of bars)
      bar.labelY =
        plotTop - labelDescent - 6 - (barRows.get(bar.index) ?? 0) * rowHeight;
  }
  return {
    bars,
    width,
    height: baseline + fontSize + 20,
    baseline,
    plotTop,
    compressed: bars.some((bar) => bar.compressed),
    clustered: bars.some((bar) => bar.clustered),
  };
}
