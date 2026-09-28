import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

// Fictional local-only data. Browser geometry supplements, but cannot replace,
// native Dynamic Type, VoiceOver, native alert or physical keyboard acceptance.
const output = path.resolve("work/impeccable-fixes");
await fs.mkdir(output, { recursive: true });
const entries = [
  ...[9, 10].map((hour) => ({
    id: `feed-${hour}`,
    type: "feed",
    start: `2026-09-26T${String(hour).padStart(2, "0")}:00:00+10:00`,
    feedKind: "formula",
    amount: 60,
    note: "",
  })),
  ...[0, 6, 15].map((hour, index) => {
    const start = new Date(
      `2026-09-26T${String(hour).padStart(2, "0")}:00:00+10:00`,
    );
    return {
      id: `sleep-${hour}`,
      type: "sleep",
      start: start.toISOString(),
      end: new Date(
        start.getTime() + [339, 100, 20][index] * 60000,
      ).toISOString(),
      note: "",
    };
  }),
  ...[7, 8, 9].map((month, index) => ({
    id: `growth-${month}`,
    type: "growth",
    start: `2026-${String(month).padStart(2, "0")}-20T10:00:00+10:00`,
    weight: 4 + index,
    length: 50 + index * 2,
    head: 34 + index,
    note: "",
  })),
];
const scenarios = [
  { width: 320, language: "zh", dark: false, contrast: "more" },
  { width: 390, language: "zh", dark: true, contrast: "more" },
  { width: 390, language: "en", dark: true, contrast: "no-preference" },
  { width: 375, language: "en", dark: false, contrast: "more" },
  { width: 768, language: "de", dark: true, contrast: "more" },
];
const totalLabels = {
  zh: ["mL 奶量", "小时 睡眠", "次 尿布"],
  en: ["mL milk", "hours sleep", "diapers"],
  "zh-Hant": ["mL 奶量", "小時 睡眠", "次 尿布"],
  fr: ["mL de lait", "h de sommeil", "couches"],
  de: ["mL Milch", "Std. Schlaf", "Windeln"],
  hi: ["mL दूध", "घंटे नींद", "डायपर"],
  it: ["mL latte", "ore sonno", "pannolini"],
  ja: ["mL ミルク", "時間 睡眠", "おむつ"],
  ko: ["mL 수유", "시간 수면", "기저귀"],
  es: ["mL leche", "horas sueño", "pañales"],
  th: ["mL นม", "ชม. นอน", "ผ้าอ้อม"],
  vi: ["mL sữa", "giờ ngủ", "tã"],
};
const browser = await chromium.launch({ headless: true });
let externalRequests = 0;
try {
  for (const scenario of scenarios) {
    const { width, language, dark, contrast } = scenario;
    const name = `${width}-${language}-${dark ? "dark" : "light"}-${contrast}`;
    const context = await browser.newContext({
      viewport: { width, height: 1024 },
      colorScheme: dark ? "dark" : "light",
      contrast,
      reducedMotion: "reduce",
      timezoneId: "Australia/Melbourne",
    });
    await context.addInitScript(
      ({ language, dark, entries }) => {
        if (!localStorage.getItem("little-days-v1-language"))
          localStorage.setItem("little-days-v1-language", language);
        localStorage.setItem("little-days-v1-dark", String(dark));
        localStorage.setItem("little-days-v1-record-view", "bars");
        localStorage.setItem(
          "little-days-v1",
          JSON.stringify({
            schemaVersion: 1,
            profile: { name: "Fixture", birthDate: "2026-07-18", sex: "male" },
            entries,
          }),
        );
      },
      { language, dark, entries },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    await page.clock.setFixedTime(new Date("2026-09-26T23:59:00+10:00"));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://little-days.test") {
        externalRequests++;
        return route.abort();
      }
      const root = path.resolve("dist-web");
      const target = path.resolve(
        root,
        "." + (url.pathname === "/" ? "/index.html" : url.pathname),
      );
      if (!target.startsWith(root + path.sep))
        return route.fulfill({ status: 403 });
      try {
        await route.fulfill({
          body: await fs.readFile(target),
          contentType: target.endsWith(".js")
            ? "application/javascript"
            : target.endsWith(".html")
              ? "text/html"
              : "application/octet-stream",
          headers: { "Content-Security-Policy": "connect-src 'none'" },
        });
      } catch {
        await route.fulfill({ status: 404 });
      }
    });
    await page.goto("http://little-days.test");
    await page.getByRole("tab").first().waitFor();
    async function inspectTotals(locale) {
      const totals = page.getByTestId("today-totals");
      await totals.waitFor();
      for (const [index, expected] of totalLabels[locale].entries()) {
        const label = page.getByTestId(`today-total-label-${index}`);
        assert.equal(await label.innerText(), expected);
        const layout = await label.evaluate((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          const box = node.getBoundingClientRect();
          const lines = [...range.getClientRects()];
          return {
            lines: new Set(lines.map((line) => Math.round(line.top))).size,
            unclipped: lines.every(
              (line) =>
                line.left >= box.left - 1 && line.right <= box.right + 1,
            ),
            left: box.left,
            right: box.right,
          };
        });
        assert.equal(
          layout.lines,
          1,
          `${name}/${locale}: single-line ${expected}`,
        );
        assert.ok(layout.unclipped, `${name}/${locale}: no truncated label`);
        assert.ok(layout.left >= 0 && layout.right <= width + 1);
      }
      assert.doesNotMatch(await totals.innerText(), /recorded|changes/);
    }
    if (scenario === scenarios[0]) {
      for (const locale of Object.keys(totalLabels)) {
        await page.evaluate((value) => {
          localStorage.setItem("little-days-v1-language", value);
        }, locale);
        await page.reload();
        await inspectTotals(locale);
        await page.screenshot({
          path: path.join(output, `today-totals-320-${locale}.png`),
        });
      }
      await page.evaluate((value) => {
        localStorage.setItem("little-days-v1-language", value);
      }, language);
      await page.reload();
    }
    await inspectTotals(language);
    await page.screenshot({ path: path.join(output, `today-${name}.png`) });
    if (language === "en") {
      await page.getByText("mL milk", { exact: true }).waitFor();
      await page.getByText("hours sleep", { exact: true }).waitFor();
      await page.getByText("diapers", { exact: true }).waitFor();
      assert.doesNotMatch(
        await page.getByTestId("today-totals").innerText(),
        /recorded|changes/,
      );
    }
    await page.getByRole("tab").nth(2).click();
    const range = page.getByTestId("record-range-options");
    await range.waitFor();
    assert.equal(await range.getByRole("button").count(), 6);
    for (const option of await range.getByRole("button").all()) {
      const box = await option.boundingBox();
      assert.ok(
        box && box.x >= 0 && box.x + box.width <= width + 1 && box.height >= 44,
        `${name}: all ranges visible, ${JSON.stringify(box)}`,
      );
    }
    await range.getByRole("button").last().click();
    assert.equal(
      await range.getByRole("button").last().getAttribute("aria-selected"),
      "true",
    );
    const recordsPlot = page.getByTestId("record-bars-plot").first();
    await recordsPlot.waitFor();
    async function inspectPlot(plot) {
      const geometry = await plot.evaluate((svg) => {
        const box = svg.viewBox.baseVal;
        return {
          width: box.width,
          height: box.height,
          labels: [...svg.querySelectorAll("text")].map((text) => {
            const bounds = text.getBBox();
            return {
              text: text.textContent,
              family: getComputedStyle(text).fontFamily,
              left: bounds.x,
              right: bounds.x + bounds.width,
              top: bounds.y,
              bottom: bounds.y + bounds.height,
            };
          }),
        };
      });
      for (const label of geometry.labels) {
        assert.ok(
          label.family.includes("system-ui"),
          `${name}: system chart font`,
        );
        assert.ok(
          label.left >= -1 &&
            label.right <= geometry.width + 1 &&
            label.top >= -1 &&
            label.bottom <= geometry.height + 1,
          `${name}: unclipped ${JSON.stringify(label)}`,
        );
      }
    }
    await inspectPlot(recordsPlot);
    for (const daily of await page.getByTestId("record-bars-plot").all()) {
      await inspectPlot(daily);
      const labels = await daily
        .getByTestId("record-bar-value-label")
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const bounds = node.getBBox();
            return {
              left: bounds.x,
              right: bounds.x + bounds.width,
              top: bounds.y,
              bottom: bounds.y + bounds.height,
            };
          }),
        );
      for (let index = 0; index < labels.length; index++)
        for (let other = 0; other < index; other++) {
          const a = labels[index],
            b = labels[other];
          assert.ok(
            Math.min(a.right, b.right) <= Math.max(a.left, b.left) ||
              Math.min(a.bottom, b.bottom) <= Math.max(a.top, b.top),
            `${name}: milk labels do not overlap`,
          );
        }
    }
    const outlines = await recordsPlot
      .getByTestId("record-bar")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          color: node.getAttribute("stroke"),
          width: Number(node.getAttribute("stroke-width")),
        })),
      );
    assert.ok(outlines.length > 0);
    assert.ok(
      outlines.every(
        (line) => line.color && line.width >= (contrast === "more" ? 2 : 1),
      ),
    );
    if (language !== "de") {
      const edit = page.getByRole("button", {
        name: language === "en" ? /^Edit Feed · / : /^编辑喂奶 · /,
      });
      const names = await edit.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-label")),
      );
      assert.equal(names.length, 2);
      assert.equal(new Set(names).size, 2);
    }
    await page.screenshot({ path: path.join(output, `records-${name}.png`) });
    await page.getByRole("tab").nth(3).click();
    const plots = page.getByTestId("growth-chart-plot");
    await plots.first().waitFor();
    assert.equal(await plots.count(), 3);
    for (const plot of await plots.all()) await inspectPlot(plot);
    assert.ok(await plots.first().getAttribute("aria-label"));
    const pageSize = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    assert.ok(
      pageSize.document <= pageSize.viewport + 1,
      `${name}: no page-wide overflow`,
    );
    await page.screenshot({ path: path.join(output, `growth-${name}.png`) });
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("little-days-v1")),
    );
    assert.deepEqual(
      saved.entries,
      entries,
      `${name}: display changes do not rewrite data`,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`UI review fixes passed: ${name}`);
  }
  assert.equal(externalRequests, 0, "No cloud requests attempted");
} finally {
  await browser.close();
}
