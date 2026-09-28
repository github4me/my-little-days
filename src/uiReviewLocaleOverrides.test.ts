import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_LOCALES } from "./locales";
import { manualEnglishOverride } from "./locales/manualOverrides";
import {
  uiReviewEnglish,
  uiReviewEnglishOverride,
} from "./locales/uiReviewOverrides";

test("draft decisions, compact totals, milk type and compression legend cover all 12 locales", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const template of Object.values(uiReviewEnglish)) {
      const value = manualEnglishOverride(locale, template);
      if (locale === "en" || locale === "zh-Hans")
        assert.equal(value, undefined);
      else {
        assert.ok(value?.trim(), `${locale}: ${template}`);
        assert.notEqual(value, template, `${locale}: no English fallback`);
        assert.equal(value?.includes("{"), false);
      }
    }
    assert.equal(uiReviewEnglishOverride(locale, "Unrelated copy"), undefined);
  }
});
