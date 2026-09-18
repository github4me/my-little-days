const { execFileSync } = require("node:child_process");
if (process.platform !== "darwin") {
  console.log(
    "Widget Swift model tests require the macOS build host; not run here.",
  );
} else {
  execFileSync("swift", ["test", "--package-path", "modules/watch-bridge"], {
    stdio: "inherit",
  });
}
