import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

// Synthetic records and blocked external origins only. SVG/browser acceptance
// supplements physical iOS checks; it does not verify native VoiceOver or
// Dynamic Type.
const output = path.resolve("work/sleep-chart-review");
await fs.mkdir(output, { recursive: true });
const fixedNow = "2026-09-26T23:59:00+10:00";
const fixtures = [
  ["long", 0, 0, 339],
  ["morning", 6, 0, 189],
  ["afternoon", 15, 0, 28],
  ["same-start-short", 16, 0, 19],
  ["same-start-long", 16, 0, 21],
  ["evening", 17, 0, 30],
  ["night-one", 19, 0, 101],
  ["night-two", 21, 0, 114],
  ["night-three", 22, 55, 62],
];
const entries = fixtures.map(([id, hour, minute, duration]) => {
  const start = new Date(
    `2026-09-26T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+10:00`,
  );
  return {
    id,
    type: "sleep",
    start: start.toISOString(),
    end: new Date(start.getTime() + duration * 60_000).toISOString(),
    note: "",
  };
});
const copy = {
  en: {
    today: "Baby's little days",
    records: "Records",
    bars: "Bar chart",
    sleep: "Sleep",
    compression:
      "Long sleep bars are shortened to the average of other sleeps; break marks and labels show the actual duration.",
    legend: "Break mark = compressed height; read the duration label.",
    crowding:
      "Nearby sleep bars are spaced apart; bottom marks show each segment’s start time within this day.",
    durations: [
      "5h 39m",
      "3h 9m",
      "28m",
      "19m",
      "21m",
      "30m",
      "1h 41m",
      "1h 54m",
      "1h 2m",
    ],
    summary: "9 sleep sessions · 14h 44m",
  },
  zh: {
    today: "宝宝的小日子",
    records: "记录",
    bars: "柱状图",
    sleep: "睡眠",
    compression:
      "长睡眠柱已缩短至其他睡眠的平均高度；断线标记和标签显示实际时长。",
    legend: "断线＝高度压缩；以标签时长为准。",
    crowding: "相邻睡眠柱已错开；底部标记表示本日片段的开始时间。",
    durations: [
      "5小时39分",
      "3小时9分",
      "28分钟",
      "19分钟",
      "21分钟",
      "30分钟",
      "1小时41分",
      "1小时54分",
      "1小时2分",
    ],
    summary: "9 段睡眠 · 14小时44分",
  },
};

function intersects(a, b) {
  return (
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
  );
}

const browser = await chromium.launch({ headless: true });
let blockedExternalRequests = 0;
try {
  for (const width of [320, 390, 768]) {
    for (const language of ["zh", "en"]) {
      for (const dark of [false, true]) {
        const words = copy[language];
        const name = `${width}-${language}-${dark ? "dark" : "light"}`;
        const context = await browser.newContext({
          viewport: { width, height: width === 768 ? 1024 : 844 },
          colorScheme: dark ? "dark" : "light",
          reducedMotion: "reduce",
          timezoneId: "Australia/Melbourne",
        });
        await context.addInitScript(
          ({ language, dark, entries }) => {
            localStorage.setItem("little-days-v1-language", language);
            localStorage.setItem("little-days-v1-dark", String(dark));
            localStorage.setItem("little-days-v1-record-view", "bars");
            localStorage.setItem(
              "little-days-v1",
              JSON.stringify({
                schemaVersion: 1,
                profile: {
                  name: language === "en" ? "Baby" : "宝宝",
                  birthDate: "2026-07-18",
                  sex: "unspecified",
                },
                entries,
              }),
            );
          },
          { language, dark, entries },
        );
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        await page.clock.setFixedTime(new Date(fixedNow));
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== "http://little-days.test") {
            blockedExternalRequests++;
            return route.abort();
          }
          try {
            const root = path.resolve("dist-web");
            const target = path.resolve(
              root,
              `.${url.pathname === "/" ? "/index.html" : url.pathname}`,
            );
            if (!target.startsWith(root + path.sep)) return route.abort();
            return route.fulfill({
              body: await fs.readFile(target),
              contentType: target.endsWith(".js")
                ? "application/javascript"
                : target.endsWith(".html")
                  ? "text/html"
                  : "application/octet-stream",
            });
          } catch {
            return route.fulfill({ status: 404 });
          }
        });
        await page.goto("http://little-days.test");
        await page
          .getByRole("heading", { name: words.today, exact: true })
          .waitFor();
        await page
          .getByRole("tab", { name: words.records, exact: true })
          .click();
        await page
          .getByRole("button", { name: words.bars, exact: true })
          .click();
        await page
          .getByRole("button", { name: words.sleep, exact: true })
          .click();
        const chart = page.getByTestId("daily-sleep-chart");
        await chart.waitFor();
        await chart.scrollIntoViewIfNeeded();
        const plot = chart.getByTestId("sleep-chart-plot");
        const plotBounds = await plot.boundingBox();
        assert.ok(
          plotBounds &&
            plotBounds.width > 0 &&
            plotBounds.x >= -1 &&
            plotBounds.x + plotBounds.width <= width + 1,
          `${name} chart bounds: ${JSON.stringify(plotBounds)}`,
        );
        const compression = chart.getByTestId("sleep-chart-compression-note");
        const legend = chart.getByTestId("sleep-chart-compression-legend");
        assert.equal(await legend.innerText(), words.legend, name);
        const legendBounds = await legend.boundingBox();
        assert.ok(
          legendBounds &&
            legendBounds.y + legendBounds.height <= plotBounds.y + 1,
          `${name}: explanation precedes compressed bars`,
        );
        const crowding = chart.getByTestId("sleep-chart-crowding-note");
        assert.equal(await compression.innerText(), words.compression, name);
        assert.equal(await crowding.innerText(), words.crowding, name);
        await page.getByText(words.summary, { exact: true }).waitFor();

        const data = await plot.evaluate((svg) => {
          const bounds = svg.getBoundingClientRect();
          const measured = (node) => {
            const box = node.getBoundingClientRect();
            return {
              text: node.textContent,
              left: box.left - bounds.left,
              top: box.top - bounds.top,
              right: box.right - bounds.left,
              bottom: box.bottom - bounds.top,
              width: box.width,
              height: box.height,
              fill: node.getAttribute("fill"),
              compressed:
                node.getAttribute("data-testid") ===
                "sleep-chart-compressed-bar",
            };
          };
          return {
            width: bounds.width,
            height: bounds.height,
            label: svg.getAttribute("aria-label"),
            labels: Array.from(
              svg.querySelectorAll('[data-testid="sleep-chart-label"]'),
              measured,
            ),
            bars: Array.from(
              svg.querySelectorAll(
                '[data-testid="sleep-chart-bar"], [data-testid="sleep-chart-compressed-bar"]',
              ),
              measured,
            ),
            anchors: svg.querySelectorAll('[data-testid="sleep-chart-anchor"]')
              .length,
          };
        });
        assert.equal(data.bars.length, entries.length, `${name} bars`);
        assert.equal(data.labels.length, entries.length, `${name} labels`);
        assert.deepEqual(
          data.labels.map((label) => label.text).sort(),
          [...words.durations].sort(),
          `${name} labels must retain true durations`,
        );
        assert.ok(
          data.bars.some((bar) => bar.compressed),
          `${name} extreme duration should be visually shortened`,
        );
        assert.ok(
          new Set(data.bars.map((bar) => bar.fill)).size > 1,
          `${name} overlapping sleeps need distinct bar colors`,
        );
        assert.equal(data.anchors, entries.length, `${name} real-time anchors`);
        for (const duration of words.durations) {
          assert.ok(
            data.label?.includes(duration),
            `${name} chart accessibility misses ${duration}`,
          );
        }
        for (const [type, elements] of [
          ["labels", data.labels],
          ["bars", data.bars],
        ]) {
          for (const element of elements) {
            assert.ok(
              [element.left, element.top, element.right, element.bottom].every(
                Number.isFinite,
              ) &&
                element.width > 0 &&
                element.height > 0 &&
                element.left >= -1 &&
                element.top >= -1 &&
                element.right <= data.width + 1 &&
                element.bottom <= data.height + 1,
              `${name} ${type} outside plot: ${JSON.stringify(element)}`,
            );
          }
          for (let first = 0; first < elements.length; first++) {
            for (let second = first + 1; second < elements.length; second++) {
              assert.ok(
                !intersects(elements[first], elements[second]),
                `${name} overlapping ${type}: ${JSON.stringify([elements[first], elements[second]])}`,
              );
            }
          }
        }
        const pageSize = await page.evaluate(() => ({
          width: window.innerWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
        }));
        assert.ok(
          pageSize.document <= pageSize.width + 1 &&
            pageSize.body <= pageSize.width + 1,
          `${name} page overflow: ${JSON.stringify(pageSize)}`,
        );
        assert.deepEqual(
          await page.evaluate(
            () => JSON.parse(localStorage.getItem("little-days-v1")).entries,
          ),
          entries,
          `${name} chart rendering must not mutate stored sleep records`,
        );
        assert.deepEqual(errors, [], `${name} browser errors`);
        await chart.screenshot({
          path: path.join(output, `sleep-chart-${name}.png`),
        });
        await context.close();
      }
    }
  }
  console.log(
    `PASS: sleep outlier/collision charts at 320, 390 and 768px in Chinese/English and Light/Dark; real duration labels, non-overlapping bounded marks, truthful notes, original records/totals preserved. External requests blocked: ${blockedExternalRequests}. Browser checks supplement physical iOS acceptance.`,
  );
} finally {
  await browser.close();
}
