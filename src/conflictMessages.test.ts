import test from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_LOCALES } from "./locales";
import { conflictMessage } from "./family/conflictMessages";

test("conflict review and replacement audit have complete localized copy", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of [
      "title",
      "explanation",
      "familyVersion",
      "yourChange",
      "keep",
      "replace",
      "later",
      "review",
      "unavailable",
      "changedAgain",
    ] as const) {
      const value = conflictMessage(locale, key);
      assert.ok(value.trim(), `${locale}:${key}`);
      assert.doesNotMatch(value, /\{[^}]+\}/, `${locale}:${key}`);
    }
    const audit = conflictMessage(locale, "replacementAudit", {
      replacer: "Alex",
      previous: "Sam",
      date: "21/09/2026, 10:00",
    });
    assert.match(audit, /Alex/);
    assert.match(audit, /Sam/);
    assert.doesNotMatch(audit, /\{[^}]+\}/);
    if (locale !== "en")
      assert.notEqual(
        conflictMessage(locale, "title"),
        conflictMessage("en", "title"),
      );
  }
});
