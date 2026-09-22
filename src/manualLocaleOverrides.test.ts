import test from "node:test";
import assert from "node:assert/strict";
import { familyBackupEnglish } from "./locales/familyBackupOverrides";
import {
  MANUAL_OVERRIDE_KEYS,
  manualEnglishOverride,
  manualEnglishOverrides,
} from "./locales/manualOverrides";

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
] as const;

const placeholders = (value: string) =>
  [...value.matchAll(/\{[A-Za-z0-9_]+\}/g)].map((match) => match[0]).sort();

test("family download help and privacy policy have translations in every additional locale", () => {
  for (const locale of locales) {
    for (const template of Object.values(familyBackupEnglish)) {
      const translated = manualEnglishOverride(locale, template);
      assert.ok(translated?.trim(), `${locale}: ${template}`);
      assert.notEqual(translated, template, `${locale}: English fallback`);
      assert.deepEqual(placeholders(translated!), placeholders(template));
    }
  }
});

test("manual safety glossary is complete and preserves placeholders", () => {
  for (const locale of locales) {
    assert.deepEqual(
      Object.keys(manualEnglishOverrides[locale]),
      [...MANUAL_OVERRIDE_KEYS],
      locale,
    );
    for (const key of MANUAL_OVERRIDE_KEYS) {
      const value = manualEnglishOverride(locale, key);
      assert.ok(value?.trim(), `${locale}: ${key}`);
      assert.deepEqual(
        placeholders(value!),
        placeholders(key),
        `${locale}: ${key}`,
      );
    }
  }
});

test("ambiguous baby-care and destructive terms use context-safe wording", () => {
  assert.equal(manualEnglishOverride("ja", "Play"), "あそび");
  assert.equal(manualEnglishOverride("ko", "Theme"), "테마");
  assert.equal(manualEnglishOverride("th", "Poo"), "อุจจาระ");
  assert.equal(manualEnglishOverride("hi", "Formula"), "फ़ॉर्मूला दूध");
  assert.equal(
    manualEnglishOverride("zh-Hant", "Close family"),
    "關閉並刪除家庭",
  );
  assert.equal(manualEnglishOverride("en", "Feed"), undefined);
});

test("reviewed locale-specific corrections override generated drafts", () => {
  assert.equal(
    manualEnglishOverride("zh-Hant", "{name}'s little days"),
    "{name}的小日子",
  );
  assert.equal(
    manualEnglishOverride(
      "th",
      "An older reminder has no reliable time or rule to migrate. In More → Care reminders, delete and recreate it, then review again. Your existing records have not been cleared.",
    ),
    "รายการเตือนเก่าไม่มีเวลาหรือกฎที่เชื่อถือได้สำหรับการย้ายข้อมูล ใน เพิ่มเติม → เตือนความจำเกี่ยวกับการดูแล ให้ลบรายการนี้แล้วสร้างใหม่ จากนั้นตรวจสอบอีกครั้ง บันทึกที่มีอยู่ของคุณไม่ได้ถูกลบ",
  );
  assert.equal(
    manualEnglishOverride("th", "No recovery copy available"),
    "ไม่มีสำเนาสำหรับกู้คืน",
  );
});

test("compact sleep summary is localized without dropping its duration", () => {
  for (const locale of locales) {
    for (const key of ["Awake · {duration}", "Last sleep · {duration}"]) {
      const value = manualEnglishOverride(locale, key);
      assert.ok(value?.trim(), `${locale}: ${key}`);
      assert.deepEqual(
        placeholders(value!),
        ["{duration}"],
        `${locale}: ${key}`,
      );
    }
  }
});

test("compact feed and diaper recency displays elapsed time only", () => {
  for (const locale of locales) {
    const value = manualEnglishOverride(locale, "{duration} ago");
    assert.ok(value?.trim(), locale);
    assert.deepEqual(placeholders(value!), ["{duration}"], locale);
  }
});
