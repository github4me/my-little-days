import assert from "node:assert/strict";
import test from "node:test";
import {
  chartAxisLayout,
  chartFontFamily,
  layoutBarValueLabels,
} from "./chartLayout";

test("SVG labels grow with text scale and geometry reserves space on every edge", () => {
  for (const width of [220, 280, 700]) {
    for (const compact of [false, true]) {
      const regular = chartAxisLayout({ width, fontScale: 1, compact });
      for (const fontScale of [1, 2, 4]) {
        const layout = chartAxisLayout({
          width,
          fontScale,
          compact,
          leftLabelChars: 7,
          xLabelChars: 8,
          xLabelCount: 7,
        });
        assert.equal(layout.fontSize, 12 * fontScale);
        assert.ok(layout.width >= width);
        assert.ok(layout.left >= 7 * layout.fontSize * 0.8 + 16);
        assert.ok(layout.plotWidth >= 6 * (8 * layout.fontSize * 0.8 + 12));
        assert.ok(layout.top > layout.fontSize);
        assert.ok(layout.axisLabelY > layout.baseline + layout.fontSize);
        assert.ok(layout.height > layout.axisLabelY + layout.fontSize);
        if (fontScale > 1) assert.ok(layout.height > regular.height);
      }
    }
  }
});

test("SVG layout has safe numeric fallbacks and platform system fonts", () => {
  for (const invalid of [NaN, Infinity, -1, 0]) {
    const layout = chartAxisLayout({ width: invalid, fontScale: invalid });
    assert.equal(layout.fontSize, 12);
    for (const value of Object.values(layout))
      assert.ok(Number.isFinite(value) && value > 0);
  }
  assert.equal(chartFontFamily("web"), "system-ui");
  assert.equal(chartFontFamily("ios"), "System");
  assert.equal(chartFontFamily("android"), "sans-serif");
});

test("nearby milk labels stagger with headroom without changing their values or anchors", () => {
  for (const fontSize of [12, 24, 48]) {
    const input = Object.freeze(
      Array.from({ length: 12 }, (_, index) =>
        Object.freeze({
          x: 110 + index,
          y: 20,
          text: index === 0 ? "亲喂" : "120",
        }),
      ),
    );
    const before = JSON.stringify(input);
    const { labels, topInset } = layoutBarValueLabels(input, 500, fontSize);
    assert.equal(labels.length, input.length);
    assert.ok(topInset > 0);
    assert.equal(JSON.stringify(input), before);
    for (const label of labels) {
      assert.equal(label.text, input[label.index].text);
      assert.ok(label.y >= fontSize + 8);
      assert.ok(label.x - label.width / 2 >= 0);
      assert.ok(label.x + label.width / 2 <= 500);
      for (const other of labels) {
        if (other.index >= label.index) continue;
        const sharedX =
          Math.abs(other.x - label.x) < (other.width + label.width) / 2 + 4;
        assert.ok(
          !sharedX || Math.abs(other.y - label.y) >= fontSize * 1.6 + 4 - 0.001,
        );
      }
    }
  }
});
