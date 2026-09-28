import test from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_LOCALES } from "./locales";
import { manualEnglishOverride } from "./locales/manualOverrides";
import {
  sleepChartEnglish,
  sleepChartEnglishOverride,
} from "./locales/sleepChartOverrides";

test("sleep chart display adjustments have distinct translations in every additional locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === "en" || locale === "zh-Hans") continue;
    const compressed = manualEnglishOverride(
      locale,
      sleepChartEnglish.compressed,
    );
    const spaced = manualEnglishOverride(locale, sleepChartEnglish.spaced);
    assert.ok(compressed?.trim(), `${locale}: compressed bars`);
    assert.ok(spaced?.trim(), `${locale}: spaced bars`);
    assert.notEqual(compressed, sleepChartEnglish.compressed, locale);
    assert.notEqual(spaced, sleepChartEnglish.spaced, locale);
    assert.notEqual(compressed, spaced, `${locale}: explanations differ`);
    assert.equal(compressed?.includes("{"), false, locale);
    assert.equal(spaced?.includes("{"), false, locale);
  }
});

test("sleep chart overrides preserve canonical English and Chinese fallback and ignore unrelated copy", () => {
  for (const locale of ["en", "zh-Hans"] as const) {
    for (const template of Object.values(sleepChartEnglish)) {
      assert.equal(sleepChartEnglishOverride(locale, template), undefined);
    }
  }
  for (const locale of SUPPORTED_LOCALES) {
    assert.equal(sleepChartEnglishOverride(locale, "Sleep"), undefined);
  }
});

test("sleep chart wording distinguishes adjusted display from actual recorded times", () => {
  assert.equal(
    manualEnglishOverride("zh-Hant", sleepChartEnglish.compressed),
    "長睡眠柱已縮短至其他睡眠的平均高度；斷線標記和標籤顯示實際時長。",
  );
  assert.equal(
    manualEnglishOverride("zh-Hant", sleepChartEnglish.spaced),
    "相鄰睡眠柱已錯開；底部標記表示本日片段的開始時間。",
  );
});
