const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const xcode = require("xcode");
const plist = require("plist");
const widget = require("../with-today-widget");
const watch = require("../with-watch-companion");
const root = path.resolve(__dirname, "../..");
const config = JSON.parse(
  fs.readFileSync(path.join(root, "app.json"), "utf8"),
).expo;
const options = widget.widgetOptions(config);
function temporary(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "little-days-widget-tests-"),
  );
  t.after(() => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith("little-days-widget-tests-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function findProject(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findProject(full);
      if (found) return found;
    } else if (entry.name === "project.pbxproj") return full;
  }
}
test("widget declares one extension, preserves Watch and adds the same phone App Group", () => {
  const current = structuredClone(config);
  current.ios.entitlements = { "aps-environment": "production" };
  watch.declareCredentials(current, watch.watchOptions(config));
  widget.declareWidget(current, options);
  widget.declareWidget(current, options);
  assert.equal(current.extra.eas.projectId, config.extra.eas.projectId);
  assert.equal(
    current.extra.eas.build.experimental.ios.appExtensions.length,
    2,
  );
  assert.deepEqual(
    current.ios.entitlements["com.apple.security.application-groups"],
    [options.appGroup],
  );
  assert.equal(current.ios.entitlements["aps-environment"], "production");
  assert.equal(
    current.ios.infoPlist.LittleDaysWidgetAppGroup,
    options.appGroup,
  );
  assert.throws(
    () =>
      widget.declareWidget(current, { ...options, bundleIdentifier: "wrong" }),
    /conflict/,
  );
});
test("widget source, metadata and localized gallery copy are generated deterministically", (t) => {
  const directory = temporary(t);
  const destination = widget.copyWidgetFiles(root, directory, options);
  const info = plist.parse(
    fs.readFileSync(path.join(destination, "Info.plist"), "utf8"),
  );
  assert.equal(
    info.NSExtension.NSExtensionPointIdentifier,
    "com.apple.widgetkit-extension",
  );
  assert.equal(info.LittleDaysWidgetAppGroup, options.appGroup);
  assert.equal(info.CFBundleVersion, "$(CURRENT_PROJECT_VERSION)");
  assert.deepEqual(info.CFBundleLocalizations, widget.LOCALES);
  assert.deepEqual(
    plist.parse(
      fs.readFileSync(
        path.join(destination, "LittleDaysTodayWidget.entitlements"),
        "utf8",
      ),
    ),
    {
      "com.apple.security.application-groups": [options.appGroup],
    },
  );
  assert.equal(
    fs.readFileSync(
      path.join(destination, "TodayWidgetSnapshot.swift"),
      "utf8",
    ),
    fs.readFileSync(
      path.join(root, "modules/watch-bridge/ios/TodayWidgetSnapshot.swift"),
      "utf8",
    ),
  );
  for (const locale of widget.LOCALES)
    assert.ok(
      fs.statSync(path.join(destination, `${locale}.lproj/Localizable.strings`))
        .size > 0,
    );
});
test("real Expo project embeds phone, Watch and widget once with independent source phases", (t) => {
  const directory = temporary(t);
  execFileSync("tar", [
    "-xzf",
    path.join(root, "node_modules/expo/template.tgz"),
    "-C",
    directory,
  ]);
  const filename = findProject(directory);
  const project = xcode.project(filename).parseSync();
  watch.ensureWatchTarget(project, watch.watchOptions(config));
  widget.ensureWidgetTarget(project, options);
  const first = project.writeSync();
  widget.ensureWidgetTarget(project, options);
  watch.ensureWatchTarget(project, watch.watchOptions(config));
  assert.equal(project.writeSync(), first, "Repeated generation is idempotent");
  fs.writeFileSync(filename, first);
  const objects = xcode.project(filename).parseSync().hash.project.objects;
  const targets = Object.entries(objects.PBXNativeTarget).filter(
    ([, value]) => value?.isa,
  );
  assert.equal(targets.length, 3);
  const [id, target] = targets.find(
    ([, value]) =>
      String(value.name).replaceAll('"', "") === "LittleDaysTodayWidget",
  );
  assert.equal(
    String(target.productType).replaceAll('"', ""),
    "com.apple.product-type.app-extension",
  );
  const sources =
    objects.PBXSourcesBuildPhase[
      target.buildPhases.find((p) => p.comment === "Sources").value
    ];
  assert.equal(sources.files.length, 2);
  const resources =
    objects.PBXResourcesBuildPhase[
      target.buildPhases.find((p) => p.comment === "Resources").value
    ];
  assert.equal(resources.files.length, 1);
  assert.equal(
    objects.PBXVariantGroup[
      objects.PBXBuildFile[resources.files[0].value].fileRef
    ].children.length,
    widget.LOCALES.length,
  );
  const generated = xcode.project(filename).parseSync();
  for (const locale of widget.LOCALES)
    assert.ok(
      generated.getFirstProject().firstProject.knownRegions.includes(locale),
    );
  for (const ref of objects.XCConfigurationList[target.buildConfigurationList]
    .buildConfigurations) {
    const settings = objects.XCBuildConfiguration[ref.value].buildSettings;
    assert.equal(settings.IPHONEOS_DEPLOYMENT_TARGET, "16.4");
    assert.equal(settings.PRODUCT_BUNDLE_IDENTIFIER, options.bundleIdentifier);
    assert.equal(
      String(settings.CURRENT_PROJECT_VERSION),
      config.ios.buildNumber,
    );
    assert.equal(settings.APPLICATION_EXTENSION_API_ONLY, "YES");
  }
  assert.ok(
    Object.values(objects.PBXTargetDependency).some(
      (value) => value?.target === id,
    ),
  );
  const embeds = Object.values(objects.PBXCopyFilesBuildPhase).filter((value) =>
    value?.files?.some(
      (file) =>
        objects.PBXBuildFile[file.value]?.fileRef === target.productReference,
    ),
  );
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].dstSubfolderSpec, 13);
});
test("widget never reads network data, receives only aggregates and clears on the serialized access boundary", () => {
  const view = fs.readFileSync(
    path.join(root, "widgets/TodayWidget.swift"),
    "utf8",
  );
  const model = fs.readFileSync(
    path.join(root, "modules/watch-bridge/ios/TodayWidgetSnapshot.swift"),
    "utf8",
  );
  const publisher = fs.readFileSync(
    path.join(root, "modules/watch-bridge/ios/TodayWidgetPublisher.swift"),
    "utf8",
  );
  const bridge = fs.readFileSync(
    path.join(root, "modules/watch-bridge/ios/LittleDaysWatchBridge.swift"),
    "utf8",
  );
  assert.doesNotMatch(
    view + model + publisher,
    /URLSession|accessToken|refreshToken|profile\[|entries\[/,
  );
  assert.match(view, /privacySensitive\(\)/);
  assert.match(view, /widgetURL\(URL\(string: "mylittledays:\/\/today"\)\)/);
  assert.match(publisher, /isExcludedFromBackup = true/);
  assert.match(publisher, /completeFileProtectionUntilFirstUserAuthentication/);
  assert.match(
    bridge,
    /try save\(value\)\s+do \{ try TodayWidgetPublisher.clear\(\)/,
  );
  assert.match(
    bridge,
    /try save\(value\)\s+do \{ try TodayWidgetPublisher.publish\(widgetContext\)/,
  );
  assert.match(model, /day == Self.dayKey/);
  assert.match(model, /date < expiresAt/);
  assert.match(model, /timeZone == calendar.timeZone.identifier/);
  assert.match(model, /var locale: String\?/);
  assert.match(model, /var formattingLocale: String\?/);
  assert.match(model, /resolvedLocale == other.resolvedLocale/);
  assert.match(
    model,
    /resolvedFormattingLocale == other.resolvedFormattingLocale/,
  );
  assert.match(publisher, /context\["locale"\]/);
  assert.match(publisher, /context\["formattingLocale"\]/);
  assert.match(view, /LocalizedStringKey\("widget.gallery.name"\)/);
  assert.doesNotMatch(view, /\?\s*"今日"\s*:\s*"Today"/);
});

test("widget body keys are present in every locale while gallery metadata stays system-localized", () => {
  const view = fs.readFileSync(
    path.join(root, "widgets/TodayWidget.swift"),
    "utf8",
  );
  const keys = new Set(
    [
      ...view.matchAll(/(?:text|LocalizedStringKey)\("(widget\.[a-z0-9_.]+)"/g),
    ].map((match) => match[1]),
  );
  for (const locale of widget.LOCALES) {
    const resource = fs.readFileSync(
      path.join(root, `widgets/${locale}.lproj/Localizable.strings`),
      "utf8",
    );
    for (const key of keys)
      assert.match(
        resource,
        new RegExp(`^"${key.replaceAll(".", "\\.")}"\\s*=`, "m"),
      );
  }
  assert.match(view, /\.environment\(\\.locale, entry.locale\)/);
  assert.match(view, /configurationDisplayName\(LocalizedStringKey/);
});
