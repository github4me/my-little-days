const fs = require("node:fs");
const path = require("node:path");
const plist = require("plist");
const Jimp = require("jimp-compact");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const TARGET_NAME = "LittleDaysWatch";
const LOCALES = [
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
const STRINGSDICT_LOCALES = ["en", "fr", "de", "it", "es"];
const SOURCE_FILES = [
  "WatchProtocol.swift",
  "WatchLocalization.swift",
  "WatchStore.swift",
  "LittleDaysWatchApp.swift",
];
const unquote = (value) => String(value ?? "").replace(/^"|"$/g, "");

function watchOptions(config, options = {}) {
  const parentBundleIdentifier = config.ios?.bundleIdentifier;
  if (!parentBundleIdentifier)
    throw new Error("Watch companion requires ios.bundleIdentifier.");
  return {
    parentBundleIdentifier,
    bundleIdentifier: `${parentBundleIdentifier}.watchkitapp`,
    version: config.version ?? "1.0.0",
    buildNumber: config.ios?.buildNumber ?? "1",
    deploymentTarget: options.deploymentTarget ?? "9.4",
    displayName: "My Little Days",
  };
}

function declareCredentials(config, options) {
  const extra = (config.extra ??= {});
  const eas = (extra.eas ??= {});
  const build = (eas.build ??= {});
  const experimental = (build.experimental ??= {});
  const ios = (experimental.ios ??= {});
  const extensions = (ios.appExtensions ??= []);
  const existing = extensions.find((item) => item.targetName === TARGET_NAME);
  if (existing && existing.bundleIdentifier !== options.bundleIdentifier) {
    throw new Error(
      "Watch target credentials conflict with its generated bundle identifier.",
    );
  }
  if (!existing)
    extensions.push({
      targetName: TARGET_NAME,
      bundleIdentifier: options.bundleIdentifier,
      entitlements: {},
    });
  return config;
}

async function copyWatchFiles(projectRoot, platformRoot, options) {
  const destination = path.join(platformRoot, TARGET_NAME);
  fs.mkdirSync(destination, { recursive: true });
  for (const filename of SOURCE_FILES) {
    const folder = filename === "WatchProtocol.swift" ? "Shared" : "WatchApp";
    fs.copyFileSync(
      path.join(projectRoot, "watch", folder, filename),
      path.join(destination, filename),
    );
  }
  for (const locale of LOCALES) {
    const localized = path.join(destination, `${locale}.lproj`);
    fs.mkdirSync(localized, { recursive: true });
    fs.copyFileSync(
      path.join(projectRoot, `watch/${locale}.lproj/Localizable.strings`),
      path.join(localized, "Localizable.strings"),
    );
    fs.copyFileSync(
      path.join(projectRoot, `watch/${locale}.lproj/InfoPlist.strings`),
      path.join(localized, "InfoPlist.strings"),
    );
    const stringsdict = path.join(
      projectRoot,
      `watch/${locale}.lproj/Localizable.stringsdict`,
    );
    if (fs.existsSync(stringsdict))
      fs.copyFileSync(
        stringsdict,
        path.join(localized, "Localizable.stringsdict"),
      );
  }
  fs.writeFileSync(
    path.join(destination, "Info.plist"),
    plist.build({
      CFBundleDevelopmentRegion: "en",
      CFBundleDisplayName: options.displayName,
      CFBundleExecutable: "$(EXECUTABLE_NAME)",
      CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
      CFBundleInfoDictionaryVersion: "6.0",
      CFBundleName: "$(PRODUCT_NAME)",
      CFBundlePackageType: "APPL",
      CFBundleShortVersionString: "$(MARKETING_VERSION)",
      CFBundleVersion: "$(CURRENT_PROJECT_VERSION)",
      CFBundleLocalizations: LOCALES,
      ITSAppUsesNonExemptEncryption: false,
      WKApplication: true,
      WKCompanionAppBundleIdentifier: options.parentBundleIdentifier,
      WKRunsIndependentlyOfCompanionApp: false,
      WKWatchOnly: false,
    }),
  );
  fs.writeFileSync(
    path.join(destination, `${TARGET_NAME}.entitlements`),
    plist.build({}),
  );
  const assets = path.join(destination, "Assets.xcassets");
  const icon = path.join(assets, "AppIcon.appiconset");
  fs.mkdirSync(icon, { recursive: true });
  fs.writeFileSync(
    path.join(assets, "Contents.json"),
    JSON.stringify({ info: { author: "xcode", version: 1 } }, null, 2),
  );
  // Keep the existing artwork, but flatten rounded transparent corners onto its
  // #C9E6FA background. Apple rejects even visually opaque PNGs with RGBA encoding.
  const artwork = await Jimp.read(path.join(projectRoot, "assets", "icon.png"));
  if (artwork.bitmap.width !== 1024 || artwork.bitmap.height !== 1024)
    throw new Error("Watch source icon must be 1024 x 1024 pixels.");
  const opaqueIcon = await new Jimp(1024, 1024, "#C9E6FA")
    .composite(artwork, 0, 0)
    .colorType(2)
    .getBufferAsync(Jimp.MIME_PNG);
  fs.writeFileSync(path.join(icon, "AppIcon.png"), opaqueIcon);
  fs.writeFileSync(
    path.join(icon, "Contents.json"),
    JSON.stringify(
      {
        images: [
          {
            filename: "AppIcon.png",
            idiom: "universal",
            platform: "watchos",
            size: "1024x1024",
          },
        ],
        info: { author: "xcode", version: 1 },
      },
      null,
      2,
    ),
  );
  return destination;
}

function ensureKnownRegions(root) {
  root.knownRegions ??= [];
  for (const locale of LOCALES) {
    if (!root.knownRegions.some((value) => unquote(value) === locale))
      root.knownRegions.push(locale);
  }
}

function ensureLocalizedResource(
  project,
  objects,
  groupId,
  targetId,
  basename,
  locales,
  fileType,
) {
  let child = objects.PBXGroup[groupId].children.find(
    (item) => item.comment === basename,
  );
  let variant = child?.value;
  if (!variant || !objects.PBXVariantGroup?.[variant]) {
    variant = project.generateUuid();
    objects.PBXVariantGroup ??= {};
    objects.PBXVariantGroup[variant] = {
      isa: "PBXVariantGroup",
      name: basename,
      sourceTree: '"<group>"',
      children: [],
    };
    objects.PBXVariantGroup[`${variant}_comment`] = basename;
    child = { value: variant, comment: basename };
    objects.PBXGroup[groupId].children.push(child);
  }
  const variantGroup = objects.PBXVariantGroup[variant];
  for (const locale of locales) {
    if (variantGroup.children.some((item) => item.comment === locale)) continue;
    const file = project.generateUuid();
    objects.PBXFileReference[file] = {
      isa: "PBXFileReference",
      lastKnownFileType: fileType,
      name: locale,
      path: `"${locale}.lproj/${basename}"`,
      sourceTree: '"<group>"',
    };
    objects.PBXFileReference[`${file}_comment`] = locale;
    variantGroup.children.push({ value: file, comment: locale });
  }
  const alreadyBuilt = Object.entries(objects.PBXBuildFile).some(
    ([id, value]) => !id.endsWith("_comment") && value?.fileRef === variant,
  );
  if (!alreadyBuilt) {
    const file = {
      uuid: project.generateUuid(),
      fileRef: variant,
      basename,
      group: "Resources",
      target: targetId,
    };
    project.addToPbxBuildFileSection(file);
    project.addToPbxResourcesBuildPhase(file);
  }
}

function ensureWatchTarget(project, options) {
  const objects = project.hash.project.objects;
  const root = project.getFirstProject().firstProject;
  ensureKnownRegions(root);
  // addTarget/addTargetDependency assume these sections already exist.
  for (const section of [
    "PBXBuildFile",
    "PBXContainerItemProxy",
    "PBXTargetDependency",
  ])
    objects[section] ??= {};
  const targets = Object.entries(objects.PBXNativeTarget).filter(
    ([id]) => !id.endsWith("_comment"),
  );
  const parent = targets.find(
    ([, target]) =>
      unquote(target.productType) === "com.apple.product-type.application" &&
      unquote(target.name) !== TARGET_NAME,
  );
  if (!parent)
    throw new Error("Cannot find the companion iPhone application target.");
  let found = targets.find(
    ([, target]) => unquote(target.name) === TARGET_NAME,
  );
  let target;
  if (found) {
    target = { uuid: found[0], pbxNativeTarget: found[1] };
  } else {
    // Modern SwiftUI single-target watchOS apps use application + watchos SDK.
    // Old watch2_app generates the legacy container/extension model instead.
    target = project.addTarget(
      TARGET_NAME,
      "application",
      TARGET_NAME,
      options.bundleIdentifier,
    );
    project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
    project.addBuildPhase(
      [],
      "PBXResourcesBuildPhase",
      "Resources",
      target.uuid,
    );
    project.addBuildPhase(
      [],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      target.uuid,
    );
  }
  const group = project.pbxGroupByName(TARGET_NAME);
  let groupId;
  if (group) {
    groupId = Object.keys(objects.PBXGroup).find(
      (id) => objects.PBXGroup[id] === group,
    );
  } else {
    const added = project.addPbxGroup([], TARGET_NAME, TARGET_NAME);
    groupId = added.uuid;
    objects.PBXGroup[root.mainGroup].children.push({
      value: groupId,
      comment: TARGET_NAME,
    });
  }
  for (const filename of SOURCE_FILES) {
    project.addSourceFile(filename, { target: target.uuid }, groupId);
  }
  const asset = project.addFile("Assets.xcassets", groupId, {
    target: target.uuid,
  });
  if (asset) {
    asset.uuid = project.generateUuid();
    asset.target = target.uuid;
    project.addToPbxBuildFileSection(asset);
    project.addToPbxResourcesBuildPhase(asset);
  }
  ensureLocalizedResource(
    project,
    objects,
    groupId,
    target.uuid,
    "Localizable.strings",
    LOCALES,
    "text.plist.strings",
  );
  ensureLocalizedResource(
    project,
    objects,
    groupId,
    target.uuid,
    "InfoPlist.strings",
    LOCALES,
    "text.plist.strings",
  );
  ensureLocalizedResource(
    project,
    objects,
    groupId,
    target.uuid,
    "Localizable.stringsdict",
    STRINGSDICT_LOCALES,
    "text.plist.stringsdict",
  );

  const configList =
    objects.XCConfigurationList[target.pbxNativeTarget.buildConfigurationList];
  const parentList =
    objects.XCConfigurationList[
      objects.PBXNativeTarget[parent[0]].buildConfigurationList
    ];
  for (const ref of configList.buildConfigurations) {
    const config = objects.XCBuildConfiguration[ref.value];
    const parentConfig = parentList.buildConfigurations
      .map((item) => objects.XCBuildConfiguration[item.value])
      .find((item) => item.name === config.name);
    Object.assign(config.buildSettings, {
      ASSETCATALOG_COMPILER_APPICON_NAME: "AppIcon",
      CLANG_ENABLE_MODULES: "YES",
      CODE_SIGN_ENTITLEMENTS: `${TARGET_NAME}/${TARGET_NAME}.entitlements`,
      CODE_SIGN_STYLE: "Automatic",
      CURRENT_PROJECT_VERSION: options.buildNumber,
      ENABLE_BITCODE: "NO",
      GENERATE_INFOPLIST_FILE: "NO",
      INFOPLIST_FILE: `${TARGET_NAME}/Info.plist`,
      LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks"',
      MARKETING_VERSION: options.version,
      PRODUCT_BUNDLE_IDENTIFIER: options.bundleIdentifier,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      SDKROOT: "watchos",
      SKIP_INSTALL: "YES",
      SUPPORTED_PLATFORMS: '"watchos watchsimulator"',
      SWIFT_VERSION: "5.0",
      SWIFT_OPTIMIZATION_LEVEL: config.name === "Debug" ? '"-Onone"' : '"-O"',
      TARGETED_DEVICE_FAMILY: "4",
      WATCHOS_DEPLOYMENT_TARGET: options.deploymentTarget,
    });
    if (parentConfig?.buildSettings.DEVELOPMENT_TEAM)
      config.buildSettings.DEVELOPMENT_TEAM =
        parentConfig.buildSettings.DEVELOPMENT_TEAM;
  }
  root.attributes ??= {};
  root.attributes.TargetAttributes ??= {};
  root.attributes.TargetAttributes[target.uuid] = {
    ...root.attributes.TargetAttributes[target.uuid],
    CreatedOnToolsVersion: "16.0",
    ProvisioningStyle: "Automatic",
  };
  const phases = objects.PBXCopyFilesBuildPhase ?? {};
  let embed = Object.entries(phases).find(
    ([id, phase]) =>
      !id.endsWith("_comment") && unquote(phase.name) === "Embed Watch Content",
  );
  if (!embed) {
    const phase = project.addBuildPhase(
      [],
      "PBXCopyFilesBuildPhase",
      "Embed Watch Content",
      parent[0],
      "watch2_app",
      '"$(CONTENTS_FOLDER_PATH)/Watch"',
    );
    embed = [phase.uuid, phase.buildPhase];
  }
  embed[1].dstPath = '"$(CONTENTS_FOLDER_PATH)/Watch"';
  embed[1].dstSubfolderSpec = 16;
  const productReference = target.pbxNativeTarget.productReference;
  const alreadyEmbedded = embed[1].files.some(
    (ref) => objects.PBXBuildFile[ref.value]?.fileRef === productReference,
  );
  if (!alreadyEmbedded) {
    const id = project.generateUuid();
    objects.PBXBuildFile[id] = {
      isa: "PBXBuildFile",
      fileRef: productReference,
      fileRef_comment: `${TARGET_NAME}.app`,
      settings: { ATTRIBUTES: ["RemoveHeadersOnCopy"] },
    };
    objects.PBXBuildFile[`${id}_comment`] =
      `${TARGET_NAME}.app in Embed Watch Content`;
    embed[1].files.push({
      value: id,
      comment: `${TARGET_NAME}.app in Embed Watch Content`,
    });
  }
  for (const ref of parentList.buildConfigurations) {
    objects.XCBuildConfiguration[
      ref.value
    ].buildSettings.ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = "YES";
  }
  return project;
}

function withWatchCompanion(config, supplied = {}) {
  const options = watchOptions(config, supplied);
  declareCredentials(config, options);
  config = withDangerousMod(config, [
    "ios",
    async (mod) => {
      await copyWatchFiles(
        mod.modRequest.projectRoot,
        mod.modRequest.platformProjectRoot,
        options,
      );
      return mod;
    },
  ]);
  return withXcodeProject(config, (mod) => {
    ensureWatchTarget(mod.modResults, options);
    return mod;
  });
}

module.exports = withWatchCompanion;
module.exports.watchOptions = watchOptions;
module.exports.declareCredentials = declareCredentials;
module.exports.copyWatchFiles = copyWatchFiles;
module.exports.ensureWatchTarget = ensureWatchTarget;
module.exports.LOCALES = LOCALES;
