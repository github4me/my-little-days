import test from "node:test";
import assert from "node:assert/strict";
import { loadAllPlayCheckins, loadPlaySelection } from "./storage.web";
import { readAvatarDataUrl } from "./avatar.web";

function browserStore(values: Record<string, string>) {
  const records = new Map(Object.entries(values));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return records.size;
      },
      key: (index: number) => [...records.keys()][index] ?? null,
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => records.set(key, value),
      removeItem: (key: string) => records.delete(key),
    },
  });
  return records;
}
test("personal check-in capture includes all dates and unknown IDs in stable order without mutating storage", async () => {
  const records = browserStore({
    "little-days-v1-play-checkins-2026-09-16":
      '["future-activity","gentle-touch","future-activity"]',
    "little-days-v1-play-checkins-2026-09-01": '["gentle-song"]',
    "another-app-play-checkins-2026-01-01": '["private"]',
  });
  const before = [...records];
  assert.deepEqual(await loadAllPlayCheckins(), [
    { day: "2026-09-01", ids: ["gentle-song"] },
    { day: "2026-09-16", ids: ["future-activity", "gentle-touch"] },
  ]);
  assert.deepEqual([...records], before);
});
test("malformed personal check-in history stops capture rather than silently omitting data", async () => {
  browserStore({
    "little-days-v1-play-checkins-2026-02-30": '["gentle-touch"]',
  });
  await assert.rejects(loadAllPlayCheckins);
  browserStore({ "little-days-v1-play-checkins-2026-02-28": "[13]" });
  await assert.rejects(loadAllPlayCheckins);
});
test("legacy favorites migrate only when a modern selection is missing, never resurrect after explicit clearing", async () => {
  const records = browserStore({
    "little-days-v1-play-favorites": '["gentle-touch"]',
  });
  assert.deepEqual(await loadPlaySelection(), {
    included: ["gentle-touch"],
    excluded: [],
  });
  records.set("little-days-v1-play-selection", '{"included":[],"excluded":[]}');
  assert.deepEqual(await loadPlaySelection(), { included: [], excluded: [] });
});
test("browser avatar capture does not follow arbitrary URLs or read native paths", async () => {
  assert.equal(await readAvatarDataUrl(null), null);
  const photo = "data:image/png;base64,iVBORw0KGgo=";
  // A signature alone is not a decodable, bounded image and must not bypass sanitization.
  await assert.rejects(() => readAvatarDataUrl(photo), /avatar_read_failed/);
  await assert.rejects(
    () => readAvatarDataUrl("https://example.test/private"),
    /avatar_read_failed/,
  );
  await assert.rejects(
    () => readAvatarDataUrl("file:///private.jpg"),
    /avatar_read_failed/,
  );
});
