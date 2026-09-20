import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCALE_REGISTRY,
  SUPPORTED_LOCALES,
  matchSupportedLocale,
  normalizeLanguagePreference,
  resolveLocalization,
} from "./locales";

test("locale registry contains the fixed supported set in English-name order", () => {
  assert.deepEqual(SUPPORTED_LOCALES, [
    "en",
    "zh-Hans",
    "zh-Hant",
    "fr",
    "de",
    "hi",
    "it",
    "ja",
    "ko",
    "es",
    "th",
    "vi",
  ]);
  assert.deepEqual(
    new Set(LOCALE_REGISTRY.map((item) => item.locale)),
    new Set(SUPPORTED_LOCALES),
  );
  assert.deepEqual(
    LOCALE_REGISTRY.map((item) => item.englishName),
    [...LOCALE_REGISTRY]
      .map((item) => item.englishName)
      .sort((left, right) => left.localeCompare(right, "en")),
  );
  assert.ok(LOCALE_REGISTRY.every((item) => item.autonym.trim()));
});

test("legacy stored language values normalize without broadening the public type", () => {
  assert.equal(normalizeLanguagePreference("zh"), "zh-Hans");
  assert.equal(normalizeLanguagePreference("en"), "en");
  assert.equal(normalizeLanguagePreference("system"), "system");
  assert.equal(normalizeLanguagePreference("pt"), null);
  assert.equal(normalizeLanguagePreference(null), null);
});

test("Chinese system locales distinguish script and region", () => {
  assert.equal(
    matchSupportedLocale({ languageCode: "zh", languageTag: "zh-Hant-CN" }),
    "zh-Hant",
  );
  assert.equal(
    matchSupportedLocale({ languageCode: "zh", languageTag: "zh-Hans-TW" }),
    "zh-Hans",
  );
  assert.equal(
    matchSupportedLocale({ languageCode: "zh", regionCode: "HK" }),
    "zh-Hant",
  );
  assert.equal(
    matchSupportedLocale({ languageCode: "zh", regionCode: "SG" }),
    "zh-Hans",
  );
  assert.equal(matchSupportedLocale({ languageTag: "zh-TW" }), "zh-Hant");
});

test("system resolution scans preferred locales and keeps the matched format tag", () => {
  assert.deepEqual(
    resolveLocalization("system", [
      { languageTag: "pt-BR", languageCode: "pt" },
      { languageTag: "fr-CA", languageCode: "fr" },
      { languageTag: "en-AU", languageCode: "en" },
    ]),
    { catalogLocale: "fr", formattingLocale: "fr-CA" },
  );
});

test("unsupported system preferences use English while explicit locales use stable formats", () => {
  assert.deepEqual(
    resolveLocalization("system", [
      { languageTag: "pt-BR", languageCode: "pt" },
      { languageTag: "ar-EG", languageCode: "ar" },
    ]),
    { catalogLocale: "en", formattingLocale: "en-AU" },
  );
  assert.deepEqual(resolveLocalization("en", []), {
    catalogLocale: "en",
    formattingLocale: "en-AU",
  });
  assert.deepEqual(resolveLocalization("hi", []), {
    catalogLocale: "hi",
    formattingLocale: "hi-IN",
  });
});
