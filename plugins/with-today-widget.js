const fs = require("node:fs");
const path = require("node:path");
const plist = require("plist");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const TARGET = "LittleDaysTodayWidget";
const GROUP_KEY = "com.apple.security.application-groups";
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
const unquote = (value) => String(value ?? "").replace(/^"|"$/g, "");

function widgetOptions(config) {
  if (!config.ios?.bundleIdentifier)
    throw new Error("Widget needs ios.bundleIdentifier.");
  return {
    bundleIdentifier: `${config.ios.bundleIdentifier}.widget`,
    appGroup: `group.${config.ios.bundleIdentifier}.widgets`,
    version: config.version,
    buildNumber: config.ios.buildNumber ?? "1",
  };
}

function declareWidget(config, options) {
  config.ios ??= {};
  config.ios.entitlements ??= {};
  config.ios.entitlements[GROUP_KEY] = [
    ...new Set([
      ...(config.ios.entitlements[GROUP_KEY] ?? []),
      options.appGroup,
    ]),
  ];
  config.ios.infoPlist ??= {};
  config.ios.infoPlist.LittleDaysWidgetAppGroup = options.appGroup;
  const ios = (((((config.extra ??= {}).eas ??= {}).build ??=
    {}).experimental ??= {}).ios ??= {});
  const extensions = (ios.appExtensions ??= []);
  const expected = {
    targetName: TARGET,
    bundleIdentifier: options.bundleIdentifier,
    entitlements: { [GROUP_KEY]: [options.appGroup] },
  };
  const existing = extensions.find((item) => item.targetName === TARGET);
  if (existing && JSON.stringify(existing) !== JSON.stringify(expected))
    throw new Error(
      "Widget credentials conflict with its generated configuration.",
    );
  if (!existing) extensions.push(expected);
  return config;
}

function copyWidgetFiles(projectRoot, platformRoot, options) {
  const destination = path.join(platformRoot, TARGET);
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, "widgets/TodayWidget.swift"),
    path.join(destination, "TodayWidget.swift"),
  );
  fs.copyFileSync(
    path.join(
      projectRoot,
      "modules/watch-bridge/ios/TodayWidgetSnapshot.swift",
    ),
    path.join(destination, "TodayWidgetSnapshot.swift"),
  );
  for (const locale of LOCALES) {
    fs.mkdirSync(path.join(destination, `${locale}.lproj`), {
      recursive: true,
    });
    fs.copyFileSync(
      path.join(projectRoot, `widgets/${locale}.lproj/Localizable.strings`),
      path.join(destination, `${locale}.lproj/Localizable.strings`),
    );
  }
  fs.writeFileSync(
    path.join(destination, "Info.plist"),
    plist.build({
      CFBundleDevelopmentRegion: "en",
      CFBundleDisplayName: "My Little Days",
      CFBundleExecutable: "$(EXECUTABLE_NAME)",
      CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
      CFBundleInfoDictionaryVersion: "6.0",
      CFBundleName: "$(PRODUCT_NAME)",
      CFBundlePackageType: "XPC!",
      CFBundleShortVersionString: "$(MARKETING_VERSION)",
      CFBundleVersion: "$(CURRENT_PROJECT_VERSION)",
      CFBundleLocalizations: LOCALES,
      LittleDaysWidgetAppGroup: options.appGroup,
      NSExtension: {
        NSExtensionPointIdentifier: "com.apple.widgetkit-extension",
      },
    }),
  );
  fs.writeFileSync(
    path.join(destination, `${TARGET}.entitlements`),
    plist.build({ [GROUP_KEY]: [options.appGroup] }),
  );
  return destination;
}

function ensureWidgetTarget(project, options) {
  const objects = project.hash.project.objects;
  const root = project.getFirstProject().firstProject;
  root.knownRegions ??= [];
  for (const locale of LOCALES) {
    if (!root.knownRegions.some((value) => unquote(value) === locale))
      root.knownRegions.push(locale);
  }
  const targets = Object.entries(objects.PBXNativeTarget).filter(
    ([, value]) => value?.isa,
  );
  const parent = targets.find(
    ([, target]) =>
      unquote(target.productType) === "com.apple.product-type.application" &&
      unquote(target.name) !== "LittleDaysWatch",
  );
  if (!parent) throw new Error("Cannot find widget's containing phone target.");
  const existing = targets.find(
    ([, target]) => unquote(target.name) === TARGET,
  );
  const target = existing
    ? { uuid: existing[0], pbxNativeTarget: existing[1] }
    : project.addTarget(
        TARGET,
        "app_extension",
        TARGET,
        options.bundleIdentifier,
      );
  if (!existing) {
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
  let group = Object.entries(objects.PBXGroup).find(
    ([, value]) => value?.name && unquote(value.name) === TARGET,
  )?.[0];
  if (!group) {
    group = project.addPbxGroup([], TARGET, TARGET).uuid;
    objects.PBXGroup[root.mainGroup].children.push({
      value: group,
      comment: TARGET,
    });
  }
  for (const filename of ["TodayWidget.swift", "TodayWidgetSnapshot.swift"])
    project.addSourceFile(filename, { target: target.uuid }, group);
  // Keep localized files in one variant group. Separate resources can
  // otherwise compete for the same output Localizable.strings file.
  let localized = objects.PBXGroup[group].children.find(
    (item) => item.comment === "Localizable.strings",
  );
  let variant = localized?.value;
  if (!variant || !objects.PBXVariantGroup?.[variant]) {
    variant = project.generateUuid();
    objects.PBXVariantGroup ??= {};
    objects.PBXVariantGroup[variant] = {
      isa: "PBXVariantGroup",
      name: "Localizable.strings",
      sourceTree: '"<group>"',
      children: [],
    };
    objects.PBXVariantGroup[`${variant}_comment`] = "Localizable.strings";
    objects.PBXGroup[group].children.push({
      value: variant,
      comment: "Localizable.strings",
    });
  }
  for (const locale of LOCALES) {
    if (
      objects.PBXVariantGroup[variant].children.some(
        (item) => item.comment === locale,
      )
    )
      continue;
    const file = project.generateUuid();
    objects.PBXFileReference[file] = {
      isa: "PBXFileReference",
      lastKnownFileType: "text.plist.strings",
      name: locale,
      path: `"${locale}.lproj/Localizable.strings"`,
      sourceTree: '"<group>"',
    };
    objects.PBXFileReference[`${file}_comment`] = locale;
    objects.PBXVariantGroup[variant].children.push({
      value: file,
      comment: locale,
    });
  }
  if (
    !Object.entries(objects.PBXBuildFile).some(
      ([id, value]) => !id.endsWith("_comment") && value?.fileRef === variant,
    )
  ) {
    const file = {
      uuid: project.generateUuid(),
      fileRef: variant,
      basename: "Localizable.strings",
      group: "Resources",
      target: target.uuid,
    };
    project.addToPbxBuildFileSection(file);
    project.addToPbxResourcesBuildPhase(file);
  }
  const parentConfigs =
    objects.XCConfigurationList[parent[1].buildConfigurationList]
      .buildConfigurations;
  for (const ref of objects.XCConfigurationList[
    target.pbxNativeTarget.buildConfigurationList
  ].buildConfigurations) {
    const config = objects.XCBuildConfiguration[ref.value];
    const parentConfig = parentConfigs
      .map((item) => objects.XCBuildConfiguration[item.value])
      .find((item) => item.name === config.name);
    Object.assign(config.buildSettings, {
      APPLICATION_EXTENSION_API_ONLY: "YES",
      CLANG_ENABLE_MODULES: "YES",
      CODE_SIGN_ENTITLEMENTS: `${TARGET}/${TARGET}.entitlements`,
      CODE_SIGN_STYLE: "Automatic",
      CURRENT_PROJECT_VERSION: options.buildNumber,
      MARKETING_VERSION: options.version,
      GENERATE_INFOPLIST_FILE: "NO",
      INFOPLIST_FILE: `${TARGET}/Info.plist`,
      IPHONEOS_DEPLOYMENT_TARGET: "16.4",
      LD_RUNPATH_SEARCH_PATHS:
        '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
      PRODUCT_BUNDLE_IDENTIFIER: options.bundleIdentifier,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      SDKROOT: "iphoneos",
      SKIP_INSTALL: "YES",
      SUPPORTED_PLATFORMS: '"iphoneos iphonesimulator"',
      SWIFT_VERSION: "5.0",
      SWIFT_OPTIMIZATION_LEVEL: config.name === "Debug" ? '"-Onone"' : '"-O"',
      TARGETED_DEVICE_FAMILY: '"1,2"',
    });
    if (parentConfig?.buildSettings.DEVELOPMENT_TEAM)
      config.buildSettings.DEVELOPMENT_TEAM =
        parentConfig.buildSettings.DEVELOPMENT_TEAM;
  }
  return project;
}

function withTodayWidget(config) {
  const options = widgetOptions(config);
  declareWidget(config, options);
  config = withDangerousMod(config, [
    "ios",
    async (mod) => {
      copyWidgetFiles(
        mod.modRequest.projectRoot,
        mod.modRequest.platformProjectRoot,
        options,
      );
      return mod;
    },
  ]);
  return withXcodeProject(config, (mod) => {
    ensureWidgetTarget(mod.modResults, options);
    return mod;
  });
}

module.exports = withTodayWidget;
Object.assign(module.exports, {
  widgetOptions,
  declareWidget,
  copyWidgetFiles,
  ensureWidgetTarget,
  LOCALES,
});
