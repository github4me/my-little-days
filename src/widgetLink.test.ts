import assert from "node:assert/strict";
import test from "node:test";
import { isTodayWidgetLink } from "./widgetLink";

test("widget links accept only the read-only Today destination", () => {
  assert.equal(isTodayWidgetLink("mylittledays://today"), true);
  assert.equal(isTodayWidgetLink("mylittledays://today/"), true);
  for (const url of [
    null,
    "",
    "https://today",
    "mylittledays://auth?code=abc",
    "mylittledays://today?delete=1",
    "mylittledays://today/other",
  ])
    assert.equal(isTodayWidgetLink(url), false);
});
