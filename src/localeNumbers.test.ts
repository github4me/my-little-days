import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDisplayNumber,
  formatEditableNumber,
  parseLocalizedNumber,
} from "./localeNumbers";

test("editable numbers use the selected formatting locale", () => {
  assert.equal(formatEditableNumber(3.5, "en-AU"), "3.5");
  assert.equal(formatEditableNumber(3.5, "fr-FR"), "3,5");
});

test("editable numbers preserve stored precision across locale round trips", () => {
  for (const value of [87.1256, Math.PI, 0.0000001, 499.99999999999994]) {
    for (const locale of ["en-AU", "fr-FR", "de-DE"]) {
      assert.equal(
        parseLocalizedNumber(formatEditableNumber(value, locale), locale),
        value,
        `${locale}: ${value}`,
      );
    }
  }
});

test("display numbers use localized separators and requested precision", () => {
  assert.equal(formatDisplayNumber(1234.5, "en-AU"), "1,234.5");
  assert.equal(formatDisplayNumber(1234.5, "fr-FR"), "1 234,5");
  assert.equal(
    formatDisplayNumber(1, "de-DE", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
    "1,0",
  );
});

test("localized number input accepts decimal point and comma keyboards", () => {
  assert.equal(parseLocalizedNumber("3,5", "fr-FR"), 3.5);
  assert.equal(parseLocalizedNumber("3.5", "fr-FR"), 3.5);
  assert.equal(parseLocalizedNumber("1,234.5", "en-AU"), 1234.5);
  assert.equal(parseLocalizedNumber("1.234,5", "de-DE"), 1234.5);
  assert.equal(parseLocalizedNumber("−3,5", "fr-FR"), -3.5);
});

test("localized number input rejects empty and malformed values", () => {
  assert.ok(Number.isNaN(parseLocalizedNumber("", "en-AU")));
  assert.ok(Number.isNaN(parseLocalizedNumber("3..5", "en-AU")));
  assert.ok(Number.isNaN(parseLocalizedNumber("three", "en-AU")));
});
