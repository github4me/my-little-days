import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

// Synthetic local-only fixtures. These checks never contact family services and
// do not stand in for native keyboard/wheel or iPad acceptance.
const output = path.resolve("work/night-appearance-review");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 390, 768]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 768 ? 1024 : 844 },
      colorScheme: "light",
      timezoneId: "Australia/Sydney",
    });
    await context.addInitScript(() => {
      localStorage.setItem("little-days-v1-language", "en");
      localStorage.setItem("little-days-v1-dark", "true");
      const birth = new Date();
      birth.setDate(birth.getDate() - 70);
      const date = `${birth.getFullYear()}-${String(birth.getMonth() + 1).padStart(2, "0")}-${String(birth.getDate()).padStart(2, "0")}`;
      localStorage.setItem(
        "little-days-v1",
        JSON.stringify({
          schemaVersion: 1,
          profile: { name: "Baby", birthDate: date, sex: "unspecified" },
          entries: [],
        }),
      );
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://little-days.test") return route.abort();
      try {
        const target = path.resolve(
          "dist-web",
          `.${url.pathname === "/" ? "/index.html" : url.pathname}`,
        );
        await route.fulfill({
          body: await fs.readFile(target),
          contentType: target.endsWith(".js")
            ? "application/javascript"
            : target.endsWith(".html")
              ? "text/html"
              : "application/octet-stream",
        });
      } catch {
        await route.fulfill({ status: 404 });
      }
    });
    await page.goto("http://little-days.test");
    await page.getByText("Baby's little days", { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(output, `today-dark-${width}.png`),
    });
    await page
      .getByRole("button", { name: "+ Add", exact: true })
      .first()
      .click();
    await page.getByLabel("Close editor", { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Close editor"]')
          ?.getBoundingClientRect().top <= 24,
    );
    const amount = page.getByLabel("Amount fed", { exact: true });
    assert.equal(
      await amount.evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(36, 36, 38)",
    );
    assert.equal(
      await amount.evaluate((el) => getComputedStyle(el).color),
      "rgb(242, 242, 247)",
    );
    await page.screenshot({
      path: path.join(output, `editor-dark-${width}.png`),
    });
    const footer = page.getByText("Saved on this device · no internet needed", {
      exact: true,
    });
    await footer.scrollIntoViewIfNeeded();
    await page.getByLabel("Notes", { exact: true }).fill("Night-time care");
    await page.screenshot({
      path: path.join(output, `editor-footer-dark-${width}.png`),
    });
    await page.getByLabel("Close editor", { exact: true }).click();
    await page.getByRole("tab", { name: "Care", exact: true }).click();
    await page.getByRole("button", { name: "Daily care", exact: true }).click();
    await page.getByRole("button", { name: "Nails", exact: true }).click();
    const careTime = page.getByLabel("Care time", { exact: true });
    await careTime.fill("09:00");
    const box = await careTime.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width);
    await page
      .getByRole("button", { name: "Save care record", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(output, `care-dark-${width}.png`),
    });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS: night base/editor/care at 320, 390 and 768px; readable input tokens, local disclosure, bounded fields; no external requests.",
  );
} finally {
  await browser.close();
}
