const { execFileSync } = require("node:child_process");
if (process.platform !== "darwin") {
  console.log(
    "Watch and Widget Swift model tests require the macOS build host; not run here.",
  );
} else {
  execFileSync("swift", ["test", "--package-path", "watch"], {
    stdio: "inherit",
  });
  execFileSync("swift", ["test", "--package-path", "modules/watch-bridge"], {
    stdio: "inherit",
  });
}
