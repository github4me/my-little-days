// Optional real CNG integration check; does not build, sign, install or upload.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const xcode = require("xcode");

if (process.platform === "win32") {
  console.log(
    "SKIP: Expo does not generate iOS projects on Windows. Run this CNG integration check on macOS or Linux; native compilation still requires Xcode.",
  );
  process.exit(0);
}

const root = path.resolve(__dirname, "../..");
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "little-days-watch-prebuild-"),
);
try {
  for (const name of [
    "app.json",
    "package.json",
    "package-lock.json",
    "assets",
    "modules",
    "plugins",
    "watch",
    "widgets",
  ]) {
    fs.cpSync(path.join(root, name), path.join(directory, name), {
      recursive: true,
    });
  }
  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(directory, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const environment = {
    ...process.env,
    CI: "1",
    EXPO_NO_GIT_STATUS: "1",
    EXPO_OFFLINE: "1",
  };
  const cli = path.join(root, "node_modules/expo/bin/cli");
  for (let pass = 0; pass < 2; pass += 1) {
    const output = execFileSync(
      process.execPath,
      [cli, "prebuild", "--platform", "ios", "--no-install"],
      {
        cwd: directory,
        env: environment,
        encoding: "utf8",
        stdio: "pipe",
        timeout: 180_000,
      },
    );
    process.stdout.write(output);
  }
  const ios = path.join(directory, "ios");
  const projectDirectory = fs
    .readdirSync(ios)
    .find((name) => name.endsWith(".xcodeproj"));
  const project = xcode
    .project(path.join(ios, projectDirectory, "project.pbxproj"))
    .parseSync();
  const targets = Object.values(
    project.hash.project.objects.PBXNativeTarget,
  ).filter((item) => item?.name?.replaceAll('"', "") === "LittleDaysWatch");
  assert.equal(
    targets.length,
    1,
    "Two full CNG runs must retain exactly one Watch target",
  );
  assert.ok(
    fs.existsSync(path.join(ios, "LittleDaysWatch/LittleDaysWatchApp.swift")),
  );
  assert.ok(fs.existsSync(path.join(ios, "LittleDaysWatch/Info.plist")));
  const watchIcon = fs.readFileSync(
    path.join(
      ios,
      "LittleDaysWatch/Assets.xcassets/AppIcon.appiconset/AppIcon.png",
    ),
  );
  assert.equal(watchIcon.readUInt32BE(16), 1024);
  assert.equal(watchIcon.readUInt32BE(20), 1024);
  assert.equal(
    watchIcon[25],
    2,
    "Generated Watch catalog icon must have no alpha channel",
  );
  console.log(
    "PASS: two clean Expo iOS generation passes retain the embedded Watch companion. Native compilation/signing not run.",
  );
} finally {
  assert.equal(path.dirname(directory), os.tmpdir());
  assert.ok(path.basename(directory).startsWith("little-days-watch-prebuild-"));
  fs.rmSync(directory, { recursive: true, force: true });
}
