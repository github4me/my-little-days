import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pngBytes = Buffer.alloc(33);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(pngBytes);
pngBytes.writeUInt32BE(13, 8);
pngBytes.write("IHDR", 12);
pngBytes.writeUInt32BE(3, 16);
pngBytes.writeUInt32BE(2, 20);
const png = `data:image/png;base64,${pngBytes.toString("base64")}`;
const encodedPixels = Buffer.from([
  255, 216, 255, 192, 0, 11, 8, 0, 3, 0, 2, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1,
  0, 0, 63, 0, 1, 2, 3, 255, 217,
]);
const jpeg = `data:image/jpeg;base64,${encodedPixels.toString("base64")}`;
function loader(overrides) {
  const modules = new Map();
  return function load(relative) {
    const filename = path.resolve(root, relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const result = { exports: {} };
    modules.set(filename, result);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(code, {
      module: result,
      exports: result.exports,
      Date,
      JSON,
      Number,
      String,
      Map,
      Set,
      decodeURIComponent,
      require(name) {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (!name.startsWith(".")) throw new Error(`Unexpected ${name}`);
        return load(path.resolve(path.dirname(filename), name + ".ts"));
      },
    });
    return result.exports;
  };
}
function files() {
  const records = new Map([
    ["file:///app/documents/little-days-avatar-123.jpg", pngBytes],
    ["file:///app/cache/ImagePicker/selected.jpg", pngBytes],
    ["file:///outside/private.jpg", pngBytes],
  ]);
  const manipulations = [];
  let renderFailure = false;
  const imageDependency = {
    SaveFormat: { JPEG: "jpeg" },
    ImageManipulator: {
      manipulate(source) {
        manipulations.push({ source });
        return {
          release() {},
          resize(size) {
            manipulations.push({ size });
          },
          async renderAsync() {
            if (renderFailure) throw new Error("unsupported_image");
            return {
              width: 2,
              height: 3,
              release() {},
              async saveAsync(options) {
                manipulations.push({ options });
                const metadata = Buffer.from("Exif\0\0fake GPS device date");
                const raw = Buffer.concat([
                  encodedPixels.subarray(0, 2),
                  Buffer.from([255, 225, 0, metadata.length + 2]),
                  metadata,
                  encodedPixels.subarray(2),
                ]);
                const uri = "file:///app/cache/ImageManipulator/output.jpg";
                records.set(uri, raw);
                return {
                  uri,
                  width: 2,
                  height: 3,
                  base64: raw.toString("base64"),
                };
              },
            };
          },
        };
      },
    },
  };
  return {
    records,
    imageDependency,
    manipulations,
    failRender: () => {
      renderFailure = true;
    },
    dependency: {
      Paths: {
        document: { uri: "file:///app/documents/" },
        cache: { uri: "file:///app/cache/" },
      },
      File: class {
        constructor(uri) {
          this.uri = uri;
        }
        get exists() {
          return records.has(this.uri);
        }
        get size() {
          return records.get(this.uri)?.length ?? 0;
        }
        async base64() {
          return records.get(this.uri).toString("base64");
        }
        delete() {
          records.delete(this.uri);
        }
      },
    },
  };
}
test("shared picked and migrated avatars re-encode oriented pixels and remove metadata without creating personal copies", async () => {
  const fixture = files();
  const avatar = loader({
    "expo-file-system": fixture.dependency,
    "expo-image-manipulator": fixture.imageDependency,
  })("src/avatar.ts");
  assert.equal(typeof avatar.readSelectedAvatarDataUrl, "function");
  const before = [...fixture.records.keys()];
  assert.equal(
    await avatar.readSelectedAvatarDataUrl(
      "file:///app/cache/ImagePicker/selected.jpg",
    ),
    jpeg,
  );
  assert.equal(
    await avatar.readAvatarDataUrl(
      "file:///app/documents/little-days-avatar-123.jpg",
    ),
    jpeg,
  );
  assert.equal(await avatar.readAvatarDataUrl(png), jpeg);
  assert.equal(
    fixture.manipulations
      .filter((m) => m.size)
      .every((m) => m.size.width === 2 && m.size.height === 3),
    true,
  );
  assert.equal(
    fixture.manipulations
      .filter((m) => m.options)
      .every((m) => m.options.format === "jpeg" && m.options.base64),
    true,
  );
  assert.deepEqual([...fixture.records.keys()], before);
  for (const uri of [
    "https://outside/private.jpg",
    "file:///outside/private.jpg",
    "file:///app/cache/../outside/private.jpg",
    "file:///app/cache/%2e%2e/outside/private.jpg",
    "file:///app/cache/..%2foutside/private.jpg",
  ])
    await assert.rejects(
      () => avatar.readSelectedAvatarDataUrl(uri),
      /avatar_read_failed/,
    );
  await assert.rejects(
    () =>
      avatar.readAvatarDataUrl("file:///app/cache/ImagePicker/selected.jpg"),
    /avatar_read_failed/,
  );
  fixture.failRender();
  await assert.rejects(
    () =>
      avatar.readSelectedAvatarDataUrl(
        "file:///app/cache/ImagePicker/selected.jpg",
      ),
    /avatar_read_failed/,
  );
});
test("full personal capture includes avatar bytes, saved settings, every check-in and rules with deterministic ordering", async () => {
  const fixture = files();
  let selection = { included: ["gentle-touch", "gentle-song"], excluded: [] };
  let history = [
    { day: "2026-09-16", ids: ["gentle-touch", "gentle-song"] },
    { day: "2026-09-01", ids: ["gentle-touch"] },
  ];
  const settings = {
    kind: "feed",
    mode: "daily",
    title: "Milk",
    minutes: 20,
    dailyTime: "07:00",
    silent: true,
  };
  const capture = loader({
    "expo-file-system": fixture.dependency,
    "expo-image-manipulator": fixture.imageDependency,
    "../storage": {
      loadAvatarUri: async () =>
        "file:///app/documents/little-days-avatar-123.jpg",
      loadPlaySelection: async () => selection,
      loadAllPlayCheckins: async () => history,
      loadReminderSettings: async () => settings,
    },
    "../reminders": {
      captureReminderRecords: async () => [
        { id: "reminder-1", kind: "reminder", settings },
      ],
    },
  })("src/family/personalExtras.ts");
  const records = await capture.loadPersonalExtras();
  assert.deepEqual(
    JSON.parse(JSON.stringify(records)).map((record) => record.id),
    [
      "avatar",
      "play-2026-09-01-gentle-touch",
      "play-2026-09-16-gentle-song",
      "play-2026-09-16-gentle-touch",
      "play-selection",
      "reminder-1",
      "reminder-settings",
    ],
  );
  assert.equal(records[0].dataUrl, jpeg);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(records.find((r) => r.id === "play-selection").selection),
    ),
    { included: ["gentle-song", "gentle-touch"], excluded: [] },
  );
  const first = JSON.stringify(records);
  selection = { included: ["gentle-song", "gentle-touch"], excluded: [] };
  history = history.reverse();
  assert.equal(JSON.stringify(await capture.loadPersonalExtras()), first);
});
