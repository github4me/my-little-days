import test from "node:test";
import assert from "node:assert/strict";
import {
  layoutSleepChart,
  type SleepChartBar,
  type SleepChartInput,
} from "./sleepChartLayout";

const options = { width: 330, fontSize: 12 };
const records = (values: number[]): SleepChartInput[] =>
  values.map((value, index) => ({ x: index * 4, value, label: `${value}h` }));

function assertDisjointBars(bars: SleepChartBar[]) {
  const sorted = [...bars].sort((a, b) => a.x - b.x);
  for (let index = 1; index < sorted.length; index++)
    assert.ok(
      sorted[index].x - sorted[index].width / 2 >=
        sorted[index - 1].x + sorted[index - 1].width / 2 + 2 - 0.000001,
    );
}

function assertAnnotationsFit(
  layout: ReturnType<typeof layoutSleepChart>,
  fontSize: number,
) {
  for (const bar of layout.bars) {
    assert.ok(bar.labelX - bar.labelWidth / 2 >= 16 - 0.000001);
    assert.ok(bar.labelX + bar.labelWidth / 2 <= layout.width - 16 + 0.000001);
    assert.ok(bar.labelY - fontSize >= 0);
    const box = {
      left: bar.labelX - bar.labelWidth / 2,
      right: bar.labelX + bar.labelWidth / 2,
      top: bar.labelY - fontSize,
      bottom: bar.labelY + Math.max(4, fontSize * 0.3),
    };
    for (const other of layout.bars) {
      if (other.index !== bar.index) {
        const otherBox = {
          left: other.labelX - other.labelWidth / 2,
          right: other.labelX + other.labelWidth / 2,
          top: other.labelY - fontSize,
          bottom: other.labelY + Math.max(4, fontSize * 0.3),
        };
        assert.ok(
          box.right <= otherBox.left ||
            otherBox.right <= box.left ||
            box.bottom <= otherBox.top ||
            otherBox.bottom <= box.top,
          `labels ${bar.index} and ${other.index} overlap`,
        );
      }
      assert.ok(
        box.right <= other.x - other.width / 2 ||
          other.x + other.width / 2 <= box.left ||
          box.bottom <= layout.baseline - other.height ||
          layout.baseline <= box.top,
        `label ${bar.index} overlaps bar ${other.index}`,
      );
    }
  }
}

test("sleep outliers use the typical mean without changing actual durations or labels", () => {
  const input = records([0.5, 1, 1.5, 8]);
  const layout = layoutSleepChart(input, options);
  assert.equal(layout.compressed, true);
  assert.deepEqual(
    layout.bars.map((bar) => bar.compressed),
    [false, false, false, true],
  );
  assert.deepEqual(
    layout.bars.map((bar) => bar.displayValue),
    [0.5, 1, 1.5, 1],
  );
  assert.deepEqual(
    layout.bars.map((bar) => bar.value),
    [0.5, 1, 1.5, 8],
  );
  assert.deepEqual(
    layout.bars.map((bar) => bar.label),
    ["0.5h", "1h", "1.5h", "8h"],
  );
  assert.equal(layout.bars[1].height, layout.bars[3].height);
  assert.ok(layout.bars[2].height > layout.bars[3].height);
});

test("sleep compression excludes every outlier from the replacement mean", () => {
  const layout = layoutSleepChart(records([0.25, 0.5, 0.75, 5, 8]), options);
  assert.deepEqual(
    layout.bars.map((bar) => bar.displayValue),
    [0.25, 0.5, 0.75, 0.5, 0.5],
  );
  assert.deepEqual(
    layout.bars.map((bar) => bar.compressed),
    [false, false, false, true, true],
  );
});

test("sleep compression starts strictly above 2.5 times the median", () => {
  const at = layoutSleepChart(records([1, 1, 2.5]), options);
  const above = layoutSleepChart(records([1, 1, 2.500001]), options);
  assert.equal(at.compressed, false);
  assert.equal(at.bars[2].displayValue, 2.5);
  assert.equal(above.compressed, true);
  assert.equal(above.bars[2].displayValue, 1);
});

test("uniform sleeps and fewer than three positive records keep their original scale", () => {
  for (const values of [[], [9], [0.5, 9], [0, 0.5, 9], [8, 8, 8]]) {
    const layout = layoutSleepChart(records(values), options);
    assert.equal(layout.compressed, false);
    assert.deepEqual(
      layout.bars.map((bar) => bar.displayValue),
      values,
    );
  }
});

test("equal sleep starts retain separate bars, real clock anchors and staggered labels", () => {
  const input = [19, 21, 57, 47].map((minutes) => ({
    x: 16,
    value: minutes / 60,
    label: `${minutes}分钟`,
  }));
  const layout = layoutSleepChart(input, options);
  assert.equal(layout.clustered, true);
  assert.ok(layout.bars.every((bar) => bar.clustered));
  for (let index = 1; index < layout.bars.length; index++)
    assert.notEqual(layout.bars[index].variant, layout.bars[index - 1].variant);
  assert.equal(new Set(layout.bars.map((bar) => bar.anchorX)).size, 1);
  assert.equal(new Set(layout.bars.map((bar) => bar.x)).size, 4);
  assert.ok(new Set(layout.bars.map((bar) => bar.labelY)).size > 1);
  assertDisjointBars(layout.bars);
  assertAnnotationsFit(layout, options.fontSize);
});

test("nearby sleep starts are balanced within midnight and end-of-day bounds", () => {
  const input = [0, 0.01, 0.02, 23.96, 23.98, 24].map((x) => ({
    x,
    value: 0.5,
    label: "30 min",
  }));
  const layout = layoutSleepChart(input, { width: 240, fontSize: 12 });
  assertDisjointBars(layout.bars);
  assertAnnotationsFit(layout, 12);
  assert.ok(
    layout.bars.every(
      (bar) =>
        bar.x - bar.width / 2 >= 16 - 0.000001 &&
        bar.x + bar.width / 2 <= layout.width - 16 + 0.000001,
    ),
  );
  assert.equal(layout.bars[0].anchorX, 16);
  assert.equal(layout.bars.at(-1)!.anchorX, layout.width - 16);
  assert.ok(layout.bars[0].x > layout.bars[0].anchorX);
  assert.ok(layout.bars.at(-1)!.x < layout.bars.at(-1)!.anchorX);
});

test("dense localized annotations expand vertically without overlaps or lost records", () => {
  const labels = [
    "1 Std. 54 Min.",
    "1小时54分",
    "1 hr 54 min",
    "1時間54分",
    "1 h 54 min",
  ];
  const input = Array.from({ length: 18 }, (_, index) => ({
    x: 17 + index / 100,
    value: 0.5 + index / 100,
    label: labels[index % labels.length],
  }));
  for (const fontSize of [24, 48, 96]) {
    const layout = layoutSleepChart(input, { width: 230, fontSize });
    const normal = layoutSleepChart(records([0.5, 1, 1.5]), {
      width: 230,
      fontSize,
    });
    assert.equal(layout.bars.length, input.length);
    assert.ok(layout.height > normal.height);
    assertDisjointBars(layout.bars);
    assertAnnotationsFit(layout, fontSize);
  }
});

test("invalid clock values, durations and options always produce finite safe geometry", () => {
  const input = [
    { x: Number.NaN, value: Number.NaN, label: "Invalid" },
    {
      x: Number.POSITIVE_INFINITY,
      value: Number.POSITIVE_INFINITY,
      label: "Invalid",
    },
    { x: -1, value: -4, label: "Invalid" },
    { x: 25, value: 0, label: "0 min" },
  ];
  const layout = layoutSleepChart(input, {
    width: Number.NaN,
    fontSize: Number.POSITIVE_INFINITY,
  });
  assert.deepEqual(
    layout.bars.map((bar) => bar.value),
    [0, 0, 0, 0],
  );
  assert.deepEqual(
    layout.bars.map((bar) => bar.height),
    [0, 0, 0, 0],
  );
  assert.equal(layout.compressed, false);
  for (const bar of layout.bars)
    for (const value of Object.values(bar))
      if (typeof value === "number") assert.ok(Number.isFinite(value));
  for (const value of [
    layout.width,
    layout.height,
    layout.baseline,
    layout.plotTop,
  ])
    assert.ok(Number.isFinite(value));
  assertDisjointBars(layout.bars);
  assertAnnotationsFit(layout, 12);
});

test("display packing preserves caller order and never mutates frozen records", () => {
  const input = Object.freeze([
    Object.freeze({ x: 20, value: 8, label: "8 hours" }),
    Object.freeze({ x: 5, value: 0.5, label: "30 min" }),
    Object.freeze({ x: 5, value: 1, label: "1 hour" }),
    Object.freeze({ x: 0, value: 1.5, label: "90 min" }),
  ]);
  const layout = layoutSleepChart(input, options);
  assert.deepEqual(
    layout.bars.map((bar) => bar.index),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    layout.bars.map((bar) => bar.label),
    input.map((bar) => bar.label),
  );
  assert.deepEqual(
    layout.bars.map((bar) => bar.value),
    input.map((bar) => bar.value),
  );
  assert.ok(layout.bars[3].x < layout.bars[1].x);
  assert.ok(layout.bars[1].x < layout.bars[2].x);
  assert.ok(layout.bars[2].x < layout.bars[0].x);
  assert.equal(input[0].value, 8);
  assert.equal(layout.bars[0].displayValue, 1);
});
