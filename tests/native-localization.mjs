import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const supportedLocales = [
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
];

test("native metadata and OS language settings cover every app locale", () => {
  const { expo } = JSON.parse(fs.readFileSync("app.json", "utf8"));
  const localization = expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-localization",
  );
  assert.ok(
    localization,
    "expo-localization must declare OS-selectable locales",
  );
  assert.deepEqual(localization[1].supportedLocales, supportedLocales);
  assert.deepEqual(Object.keys(expo.locales), supportedLocales);

  for (const locale of supportedLocales) {
    const metadata = expo.locales[locale];
    assert.ok(metadata.ios.CFBundleDisplayName, `${locale} iOS app name`);
    assert.match(
      metadata.ios.NSPhotoLibraryUsageDescription,
      /\S/,
      `${locale} photo permission`,
    );
    assert.ok(metadata.android.app_name, `${locale} Android app name`);
  }

  const imagePicker = expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-image-picker",
  );
  assert.match(imagePicker[1].photosPermission, /^Allow /);
});

test("language selection reloads native reminder rows after schedules are localized", () => {
  const source = fs.readFileSync("src/Settings.tsx", "utf8");
  const selection = source.indexOf("await onLanguageChange(value);");
  const refresh = source.indexOf("await refresh()", selection);
  assert.ok(selection >= 0, "language selection awaits the app-level update");
  assert.ok(
    refresh > selection,
    "reminder rows reload after the update completes",
  );
  assert.match(
    source.slice(selection, refresh),
    /!sharing\.current && Platform\.OS !== ["']web["']/,
    "native personal reminders only refresh outside family sharing",
  );
  assert.match(
    source.slice(
      refresh,
      source.indexOf('setMessage(t("语言已保存"))', refresh),
    ),
    /\.catch\(\(\) =>/,
    "a reminder-list read failure must not report a saved language as failed",
  );
});

test("a stale system-locale hydration cannot overwrite a fixed language", () => {
  const source = fs.readFileSync("App.tsx", "utf8");
  const effectStart = source.indexOf(
    'if (localization?.language !== "system") return;',
  );
  const effectEnd = source.indexOf("if (localization === null)", effectStart);
  assert.ok(effectStart >= 0 && effectEnd > effectStart);
  const effect = source.slice(effectStart, effectEnd);
  assert.doesNotMatch(
    effect,
    /setActiveLocale\(/,
    "only the committed I18nProvider render may update the global locale",
  );
  assert.match(
    effect,
    /current\?\.language === ["']system["']/,
    "the async result commits only while system language is still selected",
  );
});
