import assert from "node:assert/strict";
import test from "node:test";
import { dark, light } from "./palette";

function luminance(hex: string) {
  const values = hex.match(/[a-f\d]{2}/gi)!.map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("night text, placeholders and actions remain legible on every surface", () => {
  for (const surface of [
    dark.bg,
    dark.card,
    dark.elevated,
    dark.input,
    dark.soft,
  ]) {
    for (const ink of [dark.text, dark.muted, dark.primary, dark.danger]) {
      assert.ok(contrast(ink, surface) >= 4.5, `${ink} on ${surface}`);
    }
  }
  assert.ok(contrast(dark.onPrimary, dark.primary) >= 4.5);
  assert.ok(contrast(light.onPrimary, light.primary) >= 4.5);
  assert.ok(contrast(dark.heroMuted, dark.hero) >= 4.5);
  assert.ok(contrast(dark.controlLine, dark.input) >= 3);
});

test("night surfaces communicate elevation and category icons do not glare", () => {
  assert.ok(luminance(dark.bg) < luminance(dark.card));
  assert.ok(luminance(dark.card) < luminance(dark.elevated));
  for (const kind of [
    "feed",
    "diaper",
    "sleep",
    "growth",
    "milestone",
  ] as const) {
    assert.ok(luminance(dark[kind]) < 0.06);
    assert.ok(contrast(dark.icon, dark[kind]) >= 4.5);
  }
});
