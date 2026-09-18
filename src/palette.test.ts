import assert from "node:assert/strict";
import test from "node:test";
import {
  dark,
  light,
  darkHighContrast,
  lightHighContrast,
  selectPalette,
} from "./palette";

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

test("both appearances and increased contrast preserve text and control legibility", () => {
  for (const palette of [light, dark, lightHighContrast, darkHighContrast]) {
    for (const surface of [
      palette.bg,
      palette.card,
      palette.elevated,
      palette.input,
      palette.soft,
    ]) {
      for (const ink of [
        palette.text,
        palette.muted,
        palette.primary,
        palette.danger,
      ]) {
        assert.ok(contrast(ink, surface) >= 4.5, `${ink} on ${surface}`);
      }
    }
    assert.ok(contrast(palette.onPrimary, palette.primary) >= 4.5);
    assert.ok(contrast(palette.heroMuted, palette.hero) >= 4.5);
    assert.ok(contrast(palette.heroText, palette.hero) >= 4.5);
    assert.ok(contrast(palette.controlLine, palette.input) >= 3);
  }
});

test("contrast changes retain the chosen appearance and strengthen secondary text", () => {
  assert.equal(selectPalette(false), light);
  assert.equal(selectPalette(true), dark);
  assert.equal(selectPalette(false, true), lightHighContrast);
  assert.equal(selectPalette(true, true), darkHighContrast);
  for (const [base, high] of [
    [light, lightHighContrast],
    [dark, darkHighContrast],
  ]) {
    assert.equal(high.isDark, base.isDark);
    assert.ok(high.isHighContrast);
    assert.ok(contrast(high.muted, high.bg) > contrast(base.muted, base.bg));
    assert.ok(
      contrast(high.controlLine, high.input) >
        contrast(base.controlLine, base.input),
    );
  }
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
