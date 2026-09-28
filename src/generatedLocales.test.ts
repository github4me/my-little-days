import test from "node:test";
import assert from "node:assert/strict";
import {
  getGeneratedCatalog,
  getGeneratedEnglishCatalog,
  getLoadedGeneratedLocales,
  loadGeneratedCatalog,
  type GeneratedLocale,
} from "./locales/generated";

const locales = [
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
] as const satisfies readonly GeneratedLocale[];

const placeholders = (value: string) =>
  [...value.matchAll(/\{[A-Za-z0-9_]+\}/g)].map((match) => match[0]).sort();

test("generated catalogs evaluate only explicitly loaded locale modules", async () => {
  assert.deepEqual(getLoadedGeneratedLocales(), []);
  assert.equal(getGeneratedEnglishCatalog("fr"), undefined);
  assert.equal(getGeneratedCatalog("fr"), undefined);

  await loadGeneratedCatalog("fr");

  assert.deepEqual(getLoadedGeneratedLocales(), ["fr"]);
  assert.ok(getGeneratedEnglishCatalog("fr"));
  assert.ok(getGeneratedCatalog("fr"));
  assert.equal(getGeneratedEnglishCatalog("de"), undefined);
  assert.equal(getGeneratedCatalog("de"), undefined);
});

test("generated locale catalogs are complete and preserve placeholders", async () => {
  await Promise.all(locales.map((locale) => loadGeneratedCatalog(locale)));
  const expectedTemplates = Object.keys(getGeneratedEnglishCatalog("zh-Hant")!);
  const expectedCanonical = Object.keys(getGeneratedCatalog("zh-Hant")!);
  assert.ok(expectedTemplates.length > 1000);
  assert.ok(expectedCanonical.length > 400);

  for (const locale of locales) {
    const englishCatalog = getGeneratedEnglishCatalog(locale)!;
    const canonicalCatalog = getGeneratedCatalog(locale)!;
    assert.deepEqual(Object.keys(englishCatalog), expectedTemplates, locale);
    assert.deepEqual(Object.keys(canonicalCatalog), expectedCanonical, locale);
    for (const [source, value] of Object.entries(englishCatalog)) {
      assert.ok(value.trim(), `${locale}: empty translation for ${source}`);
      assert.deepEqual(
        placeholders(value),
        placeholders(source),
        `${locale}: placeholders changed for ${source}`,
      );
    }
    for (const [source, value] of Object.entries(canonicalCatalog)) {
      assert.deepEqual(
        placeholders(value),
        placeholders(source),
        `${locale}: placeholders changed for canonical key ${source}`,
      );
    }
  }
});

test("critical navigation and full-family copy have localized entries", async () => {
  await Promise.all(locales.map((locale) => loadGeneratedCatalog(locale)));
  for (const locale of locales) {
    assert.notEqual(getGeneratedCatalog(locale)!["今天"], "Today", locale);
    assert.ok(
      getGeneratedEnglishCatalog(locale)![
        "The family sharing service cannot be reached. Saved changes stay on this device and will retry when a connection is available."
      ],
      `${locale}: missing full-family network message`,
    );
  }
  assert.equal(getGeneratedCatalog("zh-Hant")!["照护"], "照護");
  assert.equal(
    getGeneratedEnglishCatalog("ja")!["{action} {title}"],
    "{title}を{action}",
  );
  assert.equal(
    getGeneratedEnglishCatalog("hi")!["{minutes} min"],
    "{minutes} मिनट",
  );
});
