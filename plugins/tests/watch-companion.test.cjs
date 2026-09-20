const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const xcode = require("xcode");
const plist = require("plist");
const Jimp = require("jimp-compact");
const plugin = require("../with-watch-companion");

const root = path.resolve(__dirname, "../..");
const expoConfig = JSON.parse(
  fs.readFileSync(path.join(root, "app.json"), "utf8"),
).expo;
const options = plugin.watchOptions(expoConfig);

function temporary(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "little-days-watch-tests-"),
  );
  t.after(() => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith("little-days-watch-tests-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function findProject(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) {
      const found = findProject(full);
      if (found) return found;
    } else if (item.name === "project.pbxproj") return full;
  }
}

test("declares Watch credentials before native mods and preserves the EAS project", () => {
  const config = structuredClone(expoConfig);
  plugin.declareCredentials(config, options);
  plugin.declareCredentials(config, options);
  assert.equal(config.extra.eas.projectId, expoConfig.extra.eas.projectId);
  assert.deepEqual(config.extra.eas.build.experimental.ios.appExtensions, [
    {
      targetName: "LittleDaysWatch",
      bundleIdentifier: "com.littledays.babylog.watchkitapp",
      entitlements: {},
    },
  ]);
  assert.throws(
    () =>
      plugin.declareCredentials(config, {
        ...options,
        bundleIdentifier: "another.app",
      }),
    /conflict/,
  );
});

test("generated companion files match the phone version and use an opaque RGB Watch icon", async (t) => {
  const directory = temporary(t);
  const destination = await plugin.copyWatchFiles(root, directory, options);
  const info = plist.parse(
    fs.readFileSync(path.join(destination, "Info.plist"), "utf8"),
  );
  assert.equal(info.WKApplication, true);
  assert.equal(
    info.WKCompanionAppBundleIdentifier,
    expoConfig.ios.bundleIdentifier,
  );
  assert.equal(info.WKRunsIndependentlyOfCompanionApp, false);
  assert.equal(info.WKWatchOnly, false);
  assert.equal(info.CFBundleVersion, "$(CURRENT_PROJECT_VERSION)");
  assert.deepEqual(info.CFBundleLocalizations, plugin.LOCALES);
  for (const filename of [
    "WatchProtocol.swift",
    "WatchLocalization.swift",
    "WatchStore.swift",
    "LittleDaysWatchApp.swift",
  ]) {
    assert.ok(fs.statSync(path.join(destination, filename)).size > 0);
  }
  for (const locale of plugin.LOCALES) {
    assert.ok(
      fs.statSync(path.join(destination, `${locale}.lproj/Localizable.strings`))
        .size > 0,
    );
    const metadata = fs.readFileSync(
      path.join(destination, `${locale}.lproj/InfoPlist.strings`),
      "utf8",
    );
    const displayName = expoConfig.locales[locale].ios.CFBundleDisplayName;
    assert.ok(metadata.includes(`"CFBundleDisplayName" = "${displayName}";`));
    assert.ok(metadata.includes(`"CFBundleName" = "${displayName}";`));
  }
  for (const locale of ["en", "fr", "de", "it", "es"])
    assert.ok(
      fs.statSync(
        path.join(destination, `${locale}.lproj/Localizable.stringsdict`),
      ).size > 0,
    );
  const icon = JSON.parse(
    fs.readFileSync(
      path.join(
        destination,
        "Assets.xcassets/AppIcon.appiconset/Contents.json",
      ),
    ),
  );
  assert.equal(icon.images[0].platform, "watchos");
  assert.equal(icon.images[0].size, "1024x1024");
  const sourceIcon = fs.readFileSync(path.join(root, "assets/icon.png"));
  const iconPath = path.join(
    destination,
    "Assets.xcassets/AppIcon.appiconset/AppIcon.png",
  );
  const generatedIcon = fs.readFileSync(iconPath);
  assert.equal(
    generatedIcon.readUInt32BE(16),
    1024,
    "Apple universal Watch icon must have 1024px width",
  );
  assert.equal(
    generatedIcon.readUInt32BE(20),
    1024,
    "Apple universal Watch icon must have 1024px height",
  );
  assert.equal(
    generatedIcon[25],
    2,
    "App Store icon must be RGB, with no alpha channel",
  );
  const input = await Jimp.read(sourceIcon);
  const output = await Jimp.read(generatedIcon);
  for (let i = 0; i < output.bitmap.data.length; i += 4) {
    assert.equal(output.bitmap.data[i + 3], 255);
    if (input.bitmap.data[i + 3] === 255) {
      assert.deepEqual(
        output.bitmap.data.subarray(i, i + 3),
        input.bitmap.data.subarray(i, i + 3),
      );
    } else if (input.bitmap.data[i + 3] === 0) {
      assert.deepEqual(
        [...output.bitmap.data.subarray(i, i + 3)],
        [201, 230, 250],
      );
    }
  }
  await plugin.copyWatchFiles(root, directory, options);
  assert.deepEqual(
    fs.readFileSync(iconPath),
    generatedIcon,
    "Regeneration must be deterministic",
  );
  assert.deepEqual(
    fs.readFileSync(path.join(root, "assets/icon.png")),
    sourceIcon,
    "Source artwork stays unchanged",
  );
});

test("real Expo template gains one modern Watch target and remains identical after regeneration", (t) => {
  const directory = temporary(t);
  execFileSync("tar", [
    "-xzf",
    path.join(root, "node_modules/expo/template.tgz"),
    "-C",
    directory,
  ]);
  const filename = findProject(directory);
  assert.ok(
    filename,
    "Installed Expo template must contain its real Xcode project",
  );
  const project = xcode.project(filename).parseSync();
  const originalTargetCount = Object.values(
    project.hash.project.objects.PBXNativeTarget,
  ).filter((value) => value?.isa).length;
  plugin.ensureWatchTarget(project, options);
  const first = project.writeSync();
  plugin.ensureWatchTarget(project, options);
  assert.equal(
    project.writeSync(),
    first,
    "Repeated config plugin execution must not duplicate targets, phases or files",
  );
  fs.writeFileSync(filename, first);
  const generated = xcode.project(filename).parseSync();
  const objects = generated.hash.project.objects;
  const targets = Object.entries(objects.PBXNativeTarget).filter(
    ([, value]) => value?.isa,
  );
  assert.equal(targets.length, originalTargetCount + 1);
  const [watchId, watch] = targets.find(
    ([, value]) => value.name.replaceAll('"', "") === "LittleDaysWatch",
  );
  assert.equal(
    watch.productType.replaceAll('"', ""),
    "com.apple.product-type.application",
  );
  assert.equal(watch.buildPhases.length, 3);
  const sourcePhase =
    objects.PBXSourcesBuildPhase[
      watch.buildPhases.find((ref) => ref.comment === "Sources").value
    ];
  assert.equal(sourcePhase.files.length, 4);
  const resourcePhase =
    objects.PBXResourcesBuildPhase[
      watch.buildPhases.find((ref) => ref.comment === "Resources").value
    ];
  assert.equal(resourcePhase.files.length, 4);
  const variants = resourcePhase.files
    .map((ref) => objects.PBXBuildFile[ref.value]?.fileRef)
    .map((ref) => objects.PBXVariantGroup?.[ref])
    .filter(Boolean);
  assert.equal(
    variants.find((variant) => variant.name === "Localizable.strings").children
      .length,
    plugin.LOCALES.length,
  );
  assert.equal(
    variants.find((variant) => variant.name === "Localizable.stringsdict")
      .children.length,
    5,
  );
  assert.equal(
    variants.find((variant) => variant.name === "InfoPlist.strings").children
      .length,
    plugin.LOCALES.length,
  );
  for (const locale of plugin.LOCALES)
    assert.ok(
      generated.getFirstProject().firstProject.knownRegions.includes(locale),
    );
  for (const ref of objects.XCConfigurationList[watch.buildConfigurationList]
    .buildConfigurations) {
    const settings = objects.XCBuildConfiguration[ref.value].buildSettings;
    assert.equal(settings.SDKROOT, "watchos");
    assert.equal(settings.WATCHOS_DEPLOYMENT_TARGET, "9.4");
    assert.equal(
      String(settings.CURRENT_PROJECT_VERSION),
      expoConfig.ios.buildNumber,
    );
    assert.equal(settings.MARKETING_VERSION, expoConfig.version);
    assert.equal(settings.PRODUCT_BUNDLE_IDENTIFIER, options.bundleIdentifier);
    assert.equal(settings.TARGETED_DEVICE_FAMILY, 4);
  }
  const embeds = Object.values(objects.PBXCopyFilesBuildPhase).filter(
    (value) => value?.name?.replaceAll('"', "") === "Embed Watch Content",
  );
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].files.length, 1);
  assert.equal(embeds[0].dstSubfolderSpec, 16);
  assert.equal(
    objects.PBXBuildFile[embeds[0].files[0].value].fileRef,
    watch.productReference,
  );
  assert.ok(
    Object.values(objects.PBXTargetDependency).some(
      (value) => value?.target === watchId,
    ),
  );
});

test("native bridge and Watch use protected durable storage and never transfer authentication tokens", () => {
  const bridge = fs.readFileSync(
    path.join(root, "modules/watch-bridge/ios/LittleDaysWatchBridge.swift"),
    "utf8",
  );
  const watch = fs.readFileSync(
    path.join(root, "watch/WatchApp/WatchStore.swift"),
    "utf8",
  );
  for (const source of [bridge, watch]) {
    assert.match(source, /isExcludedFromBackup = true/);
    assert.match(source, /completeFileProtectionUntilFirstUserAuthentication/);
    assert.match(source, /\.atomic/);
    assert.doesNotMatch(
      source,
      /accessToken|refreshToken|Authorization|URLSession/,
    );
  }
  assert.match(bridge, /receiptFingerprints\[id\] == fingerprint/);
  assert.match(bridge, /\["saved", "shared", "rejected"\]\.contains/);
  assert.match(
    bridge,
    /value\.workspaceKey != workspace \|\| context\["invalidate"\]/,
  );
  assert.match(
    fs.readFileSync(
      path.join(root, "watch/en.lproj/Localizable.strings"),
      "utf8",
    ),
    /Open Little Days on iPhone to finish syncing/,
  );
});

test("Watch UI uses keyed resources with complete locale coverage and an English fallback", () => {
  const phone = fs.readFileSync(path.join(root, "App.tsx"), "utf8");
  const contract = fs.readFileSync(
    path.join(root, "src/watchProtocol.ts"),
    "utf8",
  );
  const app = fs.readFileSync(
    path.join(root, "watch/WatchApp/LittleDaysWatchApp.swift"),
    "utf8",
  );
  const store = fs.readFileSync(
    path.join(root, "watch/WatchApp/WatchStore.swift"),
    "utf8",
  );
  const localizer = fs.readFileSync(
    path.join(root, "watch/WatchApp/WatchLocalization.swift"),
    "utf8",
  );
  assert.doesNotMatch(app + store, /func text\(_ en:|\?\s*"[^\"]+"\s*:\s*"/);
  assert.match(contract, /formattingLocale\?: string/);
  assert.match(
    phone,
    /language: isChineseLocale\(locale\)[\s\S]{0,120}locale,\s*formattingLocale,\s*profile:/,
  );
  assert.match(localizer, /path\(forResource: "en", ofType: "lproj"\)/);
  assert.doesNotMatch(localizer, /localizedStringWithFormat/);
  assert.match(
    localizer,
    /String\(format: format\(for: key\), locale: locale, arguments: arguments\)/,
  );
  const keys = new Set(
    [...(app + store).matchAll(/(?:text|plural)\("([a-z0-9_.]+)"/g)].map(
      (match) => match[1],
    ),
  );
  for (const locale of plugin.LOCALES) {
    const resource = fs.readFileSync(
      path.join(root, `watch/${locale}.lproj/Localizable.strings`),
      "utf8",
    );
    for (const key of keys)
      assert.match(
        resource,
        new RegExp(`^"${key.replaceAll(".", "\\.")}"\\s*=`, "m"),
      );
  }
});
