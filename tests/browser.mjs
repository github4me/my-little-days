import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const bundled = process.env.USE_BUNDLED_CHROMIUM
  ? (await import("@sparticuz/chromium")).default
  : null;
const browser = await chromium.launch({
  headless: true,
  executablePath: bundled ? await bundled.executablePath() : undefined,
  args: bundled ? bundled.args : ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  timezoneId: "Australia/Melbourne",
});
const page = await context.newPage();
const saveDialogs = [];
page.on("dialog", async (dialog) => {
  saveDialogs.push({ type: dialog.type(), message: dialog.message() });
  await dialog.accept();
});
const screenshotDir =
  process.env.SCREENSHOT_OUTPUT_DIR ?? "artifacts/browser-screenshots";
await fs.mkdir(screenshotDir, { recursive: true });
page.setDefaultTimeout(8000);
async function chooseEnglish() {
  await page.getByTestId("language-picker-row").click();
  return page.getByRole("radio", { name: "English", exact: true }).click();
}
await page.addInitScript(() => {
  localStorage.setItem("little-days-v1-language", "zh");
});
const fontDir = process.env.SCREENSHOT_FONT_DIR;
const fontCSS = fontDir
  ? (await fs.readFile(path.join(fontDir, "400.css"), "utf8")).replaceAll(
      "./files/",
      "/font/files/",
    ) + "\n* { font-family: 'Noto Sans SC', sans-serif !important; }"
  : "";

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function assertNoUntranslatedChinese(screen) {
  const text = await page.locator("body").innerText();
  const match = text.match(/[\p{Script=Han}]/u);
  assert.equal(
    match,
    null,
    `${screen} still contains untranslated Chinese: ${text}`,
  );
}
await page.route("http://little-days.test/**", async (route) => {
  const url = new URL(route.request().url());
  const local =
    url.pathname.startsWith("/font/") && fontDir
      ? path.join(fontDir, url.pathname.slice(6))
      : path.resolve(
          "dist-web",
          "." + (url.pathname === "/" ? "/index.html" : url.pathname),
        );
  try {
    let body = await fs.readFile(local);
    if (local.endsWith(".html") && fontCSS)
      body = Buffer.from(
        body
          .toString()
          .replace("</head>", "<style>" + fontCSS + "</style></head>"),
      );
    await route.fulfill({
      body,
      contentType: local.endsWith(".js")
        ? "application/javascript"
        : local.endsWith(".html")
          ? "text/html"
          : "application/octet-stream",
    });
  } catch {
    await route.fulfill({ status: 404, body: "not found" });
  }
});

await page.goto("http://little-days.test/");
// Run existing chart regressions with the explicit Bar preference. Calendar
// defaults and preference round trips are covered at the end of this suite.
await page.evaluate(() =>
  localStorage.setItem("little-days-v1-record-view", "bars"),
);
await page.reload();
await page.getByText("Baby的小日子", { exact: true }).waitFor();
await page.getByRole("button", { name: "打开宝宝档案", exact: true }).click();
await page.getByRole("button", { name: "收起宝宝档案", exact: true }).waitFor();
await page.getByRole("button", { name: "保存档案", exact: true }).waitFor();
await page.getByRole("tab", { name: "今天", exact: true }).click();
await page.getByRole("tab", { name: "照护", exact: true }).click();
await page.getByRole("button", { name: "早教", exact: true }).click();
await page
  .getByText(
    "还没有早教活动，请到「设置早教」添加。未设置出生日期时不会自动选择。",
    { exact: true },
  )
  .waitFor();
assert.equal(await page.getByRole("button", { name: /^查看/ }).count(), 0);
await page.getByRole("button", { name: "设置早教", exact: true }).click();
await page.getByRole("button", { name: "0–1 个月", exact: true }).click();
assert.equal(await page.getByRole("button", { name: /^查看/ }).count(), 7);
assert.equal(
  await page
    .getByRole("checkbox", { name: /^选择早教活动：/, checked: true })
    .count(),
  0,
);
await page
  .getByRole("checkbox", { name: "选择早教活动：轻声唱一小段", exact: true })
  .click();
await page
  .getByText("尚未设置有效的出生日期，无法判断是否适龄。", { exact: true })
  .waitFor();
await page.getByRole("button", { name: "仍然加入", exact: true }).click();
await page.getByRole("button", { name: "早教", exact: true }).click();
await page
  .getByRole("button", { name: "查看轻声唱一小段", exact: true })
  .waitFor();
assert.equal(await page.getByRole("button", { name: /^查看/ }).count(), 1);
await page.evaluate(() =>
  localStorage.removeItem("little-days-v1-play-selection"),
);
await page.getByRole("tab", { name: "今天", exact: true }).click();
assert.equal(await page.getByText("最近记录", { exact: true }).count(), 0);
await page.evaluate(() => {
  const a = new Date();
  a.setDate(a.getDate() - 1);
  a.setHours(6, 2, 0, 0);
  const b = new Date(a);
  b.setHours(3, 1, 0, 0);
  const old = new Date(a);
  old.setDate(old.getDate() - 1);
  const e = (id, start, amount, minutes) => ({
    id,
    type: "feed",
    feedKind: "formula",
    start: start.toISOString(),
    end: new Date(start.getTime() + minutes * 60000).toISOString(),
    amount,
    note: "",
  });
  const entries = [
    e("f1", a, 100, 11),
    e("f2", b, 150, 10),
    e("f3", old, 120, 5),
    ...[80, 90, 100, 110, 130].map((amount, index) => {
      const start = new Date(old);
      start.setDate(start.getDate() - (index + 1));
      return e(`f${index + 4}`, start, amount, 8);
    }),
    {
      id: "d1",
      type: "diaper",
      diaperKind: "mixed",
      start: a.toISOString(),
      note: "",
    },
    {
      id: "s1",
      type: "sleep",
      start: b.toISOString(),
      end: a.toISOString(),
      note: "",
    },
    {
      id: "g1",
      type: "growth",
      weight: 5.16,
      start: a.toISOString(),
      note: "",
    },
    ...[4.9, 4.7, 4.5, 4.3, 4.1].map((weight, index) => {
      const start = new Date(a);
      start.setDate(start.getDate() - (index + 1) * 7);
      return {
        id: `g${index + 2}`,
        type: "growth",
        weight,
        start: start.toISOString(),
        note: "",
      };
    }),
    {
      id: "m1",
      type: "milestone",
      title: "First smile",
      start: a.toISOString(),
      note: "",
    },
  ];
  localStorage.setItem(
    "little-days-v1",
    JSON.stringify({
      schemaVersion: 1,
      profile: { name: "QQ", birthDate: "2026-07-01", sex: "male" },
      entries,
    }),
  );
});
await page.reload();
await page.getByText("QQ的小日子", { exact: true }).waitFor();
assert.equal(await page.getByText("● 仅此设备", { exact: true }).count(), 0);
assert.match(
  await page.getByTestId("today-feed-recency").innerText(),
  /前 · 100 mL$/,
);
assert.doesNotMatch(
  await page.getByTestId("today-feed-recency").innerText(),
  /\d{2}:\d{2}/,
);
assert.match(await page.getByTestId("today-diaper-recency").innerText(), /前$/);
assert.doesNotMatch(
  await page.getByTestId("today-diaper-recency").innerText(),
  /\d{2}:\d{2}/,
);
await page.setViewportSize({ width: 320, height: 740 });
for (const kind of ["feed", "sleep", "diaper"]) {
  const header = await page.getByTestId(`today-${kind}-header`).boundingBox();
  assert.ok(
    header && header.height <= 60,
    `${kind} action should stay beside its icon`,
  );
}
for (const kind of ["feed", "diaper"]) {
  const box = await page.getByTestId(`today-${kind}-recency`).boundingBox();
  assert.ok(box && box.height <= 25, `${kind} recency should stay on one line`);
}
const sleepLine = await page.getByTestId("today-last-sleep").boundingBox();
assert.ok(
  sleepLine && sleepLine.height <= 25,
  "sleep duration and range should share one line",
);
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("tab", { name: "我的", exact: true }).click();
await chooseEnglish();
await page.getByRole("tab", { name: "Today", exact: true }).click();
assert.match(
  await page.getByTestId("today-feed-recency").innerText(),
  / ago · 100 mL$/,
);
assert.match(
  await page.getByTestId("today-diaper-recency").innerText(),
  / ago$/,
);
await page.getByRole("tab", { name: "More", exact: true }).click();
await page.getByTestId("language-picker-row").click();
await page.getByRole("radio", { name: "中文（简体）", exact: true }).click();
await page.getByRole("tab", { name: "今天", exact: true }).click();
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(screenshotDir, "home-preview.png") });
await page.getByRole("tab", { name: "记录", exact: true }).click();
for (const label of [
  "测量",
  "里程碑",
  "＋喂奶",
  "＋尿布",
  "＋睡眠",
  "＋测量",
  "＋里程碑",
  "清除",
])
  assert.equal(
    await page.getByRole("button", { name: label, exact: true }).count(),
    0,
    label,
  );
assert.equal(await page.getByRole("textbox").count(), 0);
await page.getByText("2 次喂奶 · 250 mL · 21分钟", { exact: true }).waitFor();
assert.equal(
  await page.getByRole("button", { name: "编辑喂奶", exact: true }).count(),
  0,
);
assert.equal(
  await page.getByRole("button", { name: "展开当日明细", exact: true }).count(),
  3,
);
await page
  .getByRole("button", { name: "展开当日明细", exact: true })
  .first()
  .click();
await page.getByText("距上次 3小时1分", { exact: true }).waitFor();
assert.equal(
  await page
    .getByRole("button", { name: "更多：显示前 1 天", exact: true })
    .count(),
  0,
);
const compactEdit = await page
  .getByRole("button", { name: "编辑喂奶", exact: true })
  .first()
  .boundingBox();
assert.ok(
  compactEdit &&
    compactEdit.width >= 44 &&
    compactEdit.height >= 44 &&
    compactEdit.height <= 60,
  "record actions should keep a compact layout without shrinking below the 44pt touch target",
);
const recordKindOptions = await Promise.all(
  ["喂奶", "尿布", "睡眠"].map((name) =>
    page.getByRole("button", { name, exact: true }).boundingBox(),
  ),
);
assert.ok(recordKindOptions.every(Boolean));
assert.ok(
  recordKindOptions.every(
    (box) => Math.abs(box.y - recordKindOptions[0].y) < 1 && box.height >= 60,
  ),
  "record type choices should be icon cards on one row",
);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({
  path: path.join(screenshotDir, "records-preview.png"),
});
await page.getByRole("button", { name: "时长", exact: true }).click();
const recordUnitOptions = await Promise.all(
  ["mL", "时长"].map((name) =>
    page.getByRole("button", { name, exact: true }).boundingBox(),
  ),
);
assert.ok(recordUnitOptions.every((box) => box.height >= 50));
await page
  .getByRole("button", { name: "编辑喂奶", exact: true })
  .first()
  .click();
const quickAmountButtons = await Promise.all(
  [60, 90, 120, 150].map((amount) =>
    page
      .getByRole("button", { name: `${amount} mL`, exact: true })
      .boundingBox(),
  ),
);
assert.ok(quickAmountButtons.every(Boolean));
const quickAmountTop = quickAmountButtons[0].y;
assert.ok(
  quickAmountButtons.every((box) => Math.abs(box.y - quickAmountTop) < 1),
  `quick amount choices should stay on one row: ${JSON.stringify(quickAmountButtons)}`,
);
await page.getByLabel("实际喝奶量", { exact: true }).fill("110");
await page.getByRole("button", { name: "保存记录", exact: true }).click();
await page.getByText("2 次喂奶 · 260 mL · 21分钟", { exact: true }).waitFor();
await page.getByRole("button", { name: "尿布", exact: true }).click();
await page
  .getByText("1 次更换 · 有尿 1 次 · 有便 1 次", { exact: true })
  .waitFor();
await page.evaluate(() => window.scrollTo(0, 0));
await page
  .getByRole("button", { name: "展开当日明细", exact: true })
  .first()
  .click();
await page.getByRole("button", { name: "编辑尿布", exact: true }).click();
// Read all three boxes in one frame, even if the sheet is still animating.
const diaperOptions = await page
  .getByRole("button", { name: /^(有尿|有便|尿 \+ 便)$/ })
  .evaluateAll((elements) =>
    elements.map((el) => {
      const box = el.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
assert.equal(diaperOptions.length, 3);
assert.ok(
  diaperOptions.every(
    (box) => Math.abs(box.y - diaperOptions[0].y) < 1 && box.height >= 60,
  ),
  `diaper choices should be icon cards on one row: ${JSON.stringify(diaperOptions)}`,
);
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({
  path: path.join(screenshotDir, "little-days-diaper-options-preview.png"),
});
await page.getByLabel("关闭记录编辑", { exact: true }).click();
await page.getByRole("button", { name: "删除尿布", exact: true }).click();
const deleteConfirmation = await page
  .getByRole("button", { name: "确认删除", exact: true })
  .boundingBox();
assert.ok(
  deleteConfirmation &&
    deleteConfirmation.y >= 0 &&
    deleteConfirmation.y + deleteConfirmation.height <= 844,
  "delete confirmation must appear inside the viewport without scrolling",
);
await page.getByRole("button", { name: "取消", exact: true }).click();
assert.equal(
  await page.getByRole("button", { name: "删除尿布", exact: true }).count(),
  1,
);
await page.getByRole("button", { name: "删除尿布", exact: true }).click();
await page.getByRole("button", { name: "确认删除", exact: true }).click();
await page
  .getByRole("button", { name: "删除尿布", exact: true })
  .waitFor({ state: "detached" });
assert.equal(
  await page.getByRole("button", { name: "撤销删除", exact: true }).count(),
  0,
);
assert.equal(
  await page.getByText("已删除一条记录", { exact: true }).count(),
  0,
);
assert.equal(
  await page.evaluate(() =>
    JSON.parse(localStorage.getItem("little-days-v1")).entries.some(
      (e) => e.id === "d1",
    ),
  ),
  false,
);
await page.getByRole("button", { name: "睡眠", exact: true }).click();
await page.getByText("1 段睡眠 · 3小时1分", { exact: true }).waitFor();
await page
  .getByRole("button", { name: "展开当日明细", exact: true })
  .first()
  .click();
await page
  .locator("svg text")
  .filter({ hasText: /^3小时1分$/ })
  .waitFor();
await page.getByRole("tab", { name: "成长", exact: true }).click();
assert.equal(await page.getByText("小小里程碑", { exact: true }).count(), 0);
assert.equal(await page.getByText("日常趋势", { exact: true }).count(), 0);
await page.getByRole("button", { name: "＋测量", exact: true }).waitFor();
assert.equal(
  await page
    .getByRole("button", { name: "全部", exact: true })
    .getAttribute("aria-selected"),
  "true",
);
await page
  .getByText("三项曲线按各自单位缩放；切换到单项可查看 WHO 参考。", {
    exact: true,
  })
  .waitFor();
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(screenshotDir, "growth-preview.png") });
assert.equal(
  (
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("little-days-v1")),
    )
  ).entries.length,
  16,
);
await page.getByRole("tab", { name: "我的", exact: true }).click();
assert.equal(await page.getByLabel("宝宝名字", { exact: true }).count(), 0);
const languageRow = page.getByTestId("language-picker-row");
assert.equal(await languageRow.getAttribute("aria-expanded"), "false");
await languageRow.click();
assert.equal(await languageRow.getAttribute("aria-expanded"), "true");
await page.getByRole("button", { name: "完成", exact: true }).click();
for (const section of ["主题", "照护提醒", "备份与恢复", "致谢"]) {
  const header = page.getByRole("button", {
    name: `展开${section}`,
    exact: true,
  });
  assert.equal(await header.getAttribute("aria-expanded"), "false");
  await header.click();
  const expanded = page.getByRole("button", {
    name: `收起${section}`,
    exact: true,
  });
  assert.equal(await expanded.getAttribute("aria-expanded"), "true");
  if (section === "致谢") {
    await page
      .getByText(
        "感谢 Trista（来自 FPH）和她群里的 Mia、Violet、Bill 提出的建议与想法，也感谢群里每一位妈妈爸爸的支持。期待更多妈妈爸爸出现在这里，一起让小日子更好。",
        { exact: true },
      )
      .waitFor();
  }
  await expanded.click();
}
assert.equal(
  await page
    .getByRole("button", { name: "展开隐私与支持", exact: true })
    .count(),
  0,
);
assert.equal(
  await page.getByRole("button", { name: "隐私与支持", exact: true }).count(),
  1,
);
await page.screenshot({
  path: path.join(screenshotDir, "little-days-more-collapsed.png"),
});
await page.getByRole("button", { name: "展开主题", exact: true }).click();
assert.equal(
  await page
    .getByRole("button", { name: "查看上次替换前的数据", exact: true })
    .count(),
  0,
);
await page.getByRole("button", { name: "展开宝宝档案", exact: true }).click();
await page.getByLabel("宝宝名字", { exact: true }).waitFor();
const sexOptions = await Promise.all(
  ["男宝宝", "女宝宝", "暂不填写"].map((name) =>
    page.getByRole("button", { name, exact: true }).boundingBox(),
  ),
);
assert.ok(
  sexOptions.every(
    (box) => Math.abs(box.y - sexOptions[0].y) < 1 && box.height >= 60,
  ),
  "profile choices should be icon cards on one row",
);
const nightModeSwitch = page.getByRole("radio", {
  name: "深色",
  exact: true,
});
await page.emulateMedia({ colorScheme: "dark" });
await page
  .getByRole("radio", { name: "自动（跟随系统）", exact: true, checked: true })
  .waitFor();
assert.equal(
  await page.evaluate(() => localStorage.getItem("little-days-v1-dark")),
  null,
);
await page.emulateMedia({ colorScheme: "light" });
await page
  .getByRole("radio", { name: "自动（跟随系统）", exact: true, checked: true })
  .waitFor();
const nightModeBox = await nightModeSwitch.boundingBox();
assert.ok(nightModeBox);
assert.ok(
  nightModeBox.x + nightModeBox.width <= 370,
  "night mode switch should fit inside the settings card",
);
await nightModeSwitch.click();
await page.waitForFunction(
  () => localStorage.getItem("little-days-v1-dark") === "true",
);
await page.emulateMedia({ colorScheme: "dark" });
await page.emulateMedia({ colorScheme: "light" });
assert.equal(await nightModeSwitch.isChecked(), true);
await page.reload();
await page.getByRole("tab", { name: "我的", exact: true }).click();
await page.getByRole("button", { name: "展开主题", exact: true }).click();
await page
  .getByRole("radio", { name: "深色", exact: true, checked: true })
  .waitFor();
assert.equal(
  await page.evaluate(() => localStorage.getItem("little-days-v1-dark")),
  "true",
);
await chooseEnglish();
await page.getByRole("radio", { name: "Light", exact: true }).click();
await page.waitForFunction(
  () => localStorage.getItem("little-days-v1-dark") === "false",
);
await page.getByRole("radio", { name: "Automatic", exact: true }).click();
await page.waitForFunction(
  () => localStorage.getItem("little-days-v1-dark") === "null",
);
await page.reload();
await page.getByRole("tab", { name: "我的", exact: true }).click();
await page.getByRole("button", { name: "展开主题", exact: true }).click();
await page
  .getByRole("radio", { name: "自动（跟随系统）", exact: true, checked: true })
  .waitFor();
await page.getByRole("radio", { name: "深色", exact: true }).click();
await chooseEnglish();
await page.getByText("Care reminders", { exact: true }).waitFor();
assert.equal(await page.getByText("● This device", { exact: true }).count(), 0);
await page.getByTestId("language-picker-row").click();
const languageOptions = [
  "Follow system",
  "中文（简体）",
  "中文（繁體）",
  "English",
  "Français",
  "Deutsch",
  "हिन्दी",
  "Italiano",
  "日本語",
  "한국어",
  "Español",
  "ไทย",
  "Tiếng Việt",
];
assert.deepEqual(
  await page
    .getByTestId("language-options")
    .getByRole("radio")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")),
    ),
  languageOptions,
);
await page.getByRole("button", { name: "Done", exact: true }).click();
assert.equal(
  await page
    .getByRole("button", { name: "Expand Privacy & support", exact: true })
    .count(),
  0,
);
await page
  .getByRole("button", { name: "Privacy & support", exact: true })
  .click();
await page.getByText("Your data, your choices", { exact: true }).waitFor();
await page.getByText("Software updates", { exact: true }).waitFor();
await page.getByText("contact@reticle.com.au", { exact: true }).waitFor();
assert.equal(
  await page
    .getByRole("button", { name: "Contact support", exact: true })
    .count(),
  1,
);
await assertNoUntranslatedChinese("Privacy & support");
assert.equal(await page.getByText("Credits", { exact: true }).count(), 0);
await page.getByRole("button", { name: "Back to More", exact: true }).click();
const creditsHeader = page.getByRole("button", {
  name: "Expand Credits",
  exact: true,
});
assert.equal(await creditsHeader.getAttribute("aria-expanded"), "false");
await creditsHeader.click();
await page
  .getByText(
    "Thank you to Trista from FPH and Mia, Violet, and Bill in her group for their suggestions and ideas, and to all the mums and dads in the group for their support. We hope to see more mums and dads here, helping make My Little Days even better.",
    { exact: true },
  )
  .waitFor();
await page
  .getByRole("button", { name: "Collapse Credits", exact: true })
  .click();
assert.equal(await creditsHeader.getAttribute("aria-expanded"), "false");
await page.getByText("Care reminders", { exact: true }).waitFor();
await page.screenshot({
  path: path.join(screenshotDir, "little-days-language-preview.png"),
});
await assertNoUntranslatedChinese("Settings");
await page.getByRole("tab", { name: "Today", exact: true }).click();
await page.getByText("QQ's little days", { exact: true }).waitFor();
await assertNoUntranslatedChinese("Today");
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(screenshotDir, "night-preview.png") });
await page.getByRole("tab", { name: "Growth", exact: true }).click();
await page.getByText("Growth charts", { exact: true }).waitFor();
await page
  .getByRole("button", { name: "Show 1 earlier records", exact: true })
  .waitFor();
assert.equal(
  await page.getByText("4.1 kg", { exact: false }).count(),
  0,
  "older growth measurements should be collapsed by default",
);
await page
  .getByRole("button", { name: "Show 1 earlier records", exact: true })
  .click();
await page
  .getByRole("button", { name: "Hide earlier records", exact: true })
  .waitFor();
await page.getByText("4.1 kg", { exact: false }).waitFor();
for (const name of ["Edit Measure", "Delete Measure"]) {
  const action = page.getByRole("button", { name, exact: true }).last();
  assert.equal(await action.locator("svg").count(), 1);
  assert.equal(await action.innerText(), "");
  const target = await action.boundingBox();
  assert.ok(target.width >= 44 && target.height >= 44);
}
await page
  .getByRole("button", { name: "Delete Measure", exact: true })
  .last()
  .click();
const growthDeleteConfirmation = await page
  .getByRole("button", { name: "Delete record", exact: true })
  .boundingBox();
assert.ok(
  growthDeleteConfirmation &&
    growthDeleteConfirmation.y >= 0 &&
    growthDeleteConfirmation.y + growthDeleteConfirmation.height <= 844,
);
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await page.getByText("4.1 kg", { exact: false }).waitFor();
await page
  .getByRole("button", { name: "Delete Measure", exact: true })
  .last()
  .click();
await page.getByRole("button", { name: "Delete record", exact: true }).click();
await page.getByText("4.1 kg", { exact: false }).waitFor({ state: "detached" });
assert.equal(
  await page.evaluate(() =>
    JSON.parse(localStorage.getItem("little-days-v1")).entries.some(
      (e) => e.id === "g6",
    ),
  ),
  false,
);
const metricOptions = await Promise.all(
  ["All", "Weight", "Length", "Head"].map((name) =>
    page.getByRole("button", { name, exact: true }).boundingBox(),
  ),
);
assert.ok(metricOptions.every(Boolean));
assert.ok(
  metricOptions.every((box) => Math.abs(box.y - metricOptions[0].y) < 1),
  "growth metric choices should stay on one row",
);
await assertNoUntranslatedChinese("Growth");
await page.screenshot({
  path: path.join(screenshotDir, "little-days-growth-picker-preview.png"),
});
await page.getByRole("button", { name: "+ Measure", exact: true }).click();
await page.getByText("Measurement", { exact: true }).waitFor();
await page
  .getByText("Enter at least one value; decimals are kept as measured.", {
    exact: true,
  })
  .waitFor();
for (const label of ["Weight · kg", "Length · cm", "Head · cm"])
  await page.getByLabel(label, { exact: true }).waitFor();
await assertNoUntranslatedChinese("Growth measurement editor");
await page.getByLabel("Close editor", { exact: true }).click();
await page.getByRole("tab", { name: "Records", exact: true }).click();
await page.getByText("Last 7 days", { exact: true }).waitFor();
for (const [label, title] of [
  ["2 weeks", "Last 2 weeks"],
  ["1 month", "Last month"],
  ["3 months", "Last 3 months"],
  ["6 months", "Last 6 months"],
  ["All", "All records"],
]) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByText(title, { exact: true }).waitFor();
}
await assertNoUntranslatedChinese("Records date ranges");
await page.screenshot({
  path: path.join(screenshotDir, "little-days-record-ranges.png"),
});
assert.equal(
  await page
    .getByRole("button", { name: "Show day details", exact: true })
    .count(),
  3,
);
await page
  .getByRole("button", { name: "More: show 4 earlier days", exact: true })
  .click();
assert.equal(
  await page
    .getByRole("button", { name: "Show day details", exact: true })
    .count(),
  7,
);
await page
  .getByRole("button", { name: "Hide earlier days", exact: true })
  .click();
assert.equal(
  await page
    .getByRole("button", { name: "Show day details", exact: true })
    .count(),
  3,
);
assert.equal(
  await page.getByRole("button", { name: "Edit Feed", exact: true }).count(),
  0,
);
await page
  .getByRole("button", { name: "Show day details", exact: true })
  .last()
  .click();
await page.getByRole("button", { name: "Edit Feed", exact: true }).waitFor();
await assertNoUntranslatedChinese("Records");
await page.getByRole("button", { name: "Diaper", exact: true }).click();
await page.getByText("changes", { exact: true }).waitFor();
await assertNoUntranslatedChinese("Diaper records");
await page.setViewportSize({ width: 340, height: 740 });
await page.getByRole("tab", { name: "Growth", exact: true }).click();
await page.getByText("Growth charts", { exact: true }).waitFor();
const narrowMetricOptions = await Promise.all(
  ["All", "Weight", "Length", "Head"].map((name) =>
    page.getByRole("button", { name, exact: true }).boundingBox(),
  ),
);
assert.ok(
  narrowMetricOptions.every(
    (box) => Math.abs(box.y - narrowMetricOptions[0].y) < 1,
  ),
  "growth metric choices should stay on one row on a narrow phone",
);
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  true,
);
await page.getByRole("tab", { name: "Records", exact: true }).click();
await page.getByText("Last 7 days", { exact: true }).waitFor();
const narrowRecordsHeading = await page
  .getByRole("heading", { name: "Records", exact: true })
  .boundingBox();
assert.ok(narrowRecordsHeading);
assert.ok(
  narrowRecordsHeading.x + narrowRecordsHeading.width <= 320,
  "records heading should fit the narrow screen content",
);
const narrowRecordKindOptions = await Promise.all(
  ["Feed", "Diaper", "Sleep"].map((name) =>
    page.getByRole("button", { name, exact: true }).boundingBox(),
  ),
);
assert.ok(
  narrowRecordKindOptions.every(
    (box) =>
      box &&
      box.width >= 44 &&
      box.height >= 44 &&
      box.x >= 20 &&
      box.x + box.width <= 320,
  ),
  "record type choices should wrap within the narrow content area without shrinking touch targets",
);
for (let index = 1; index < narrowRecordKindOptions.length; index++) {
  const current = narrowRecordKindOptions[index],
    previous = narrowRecordKindOptions[index - 1];
  assert.ok(
    current.x >= previous.x + previous.width ||
      current.y >= previous.y + previous.height,
    "wrapped record choices must retain reading order without overlap",
  );
}
await page.getByRole("tab", { name: "Today", exact: true }).click();
await page.getByRole("button", { name: "+ Add", exact: true }).first().click();
await page.getByLabel("Time date", { exact: true }).fill("2026-08-28");
await page.getByLabel("Time time", { exact: true }).fill("23:50");
await page
  .getByRole("button", { name: "+ Add end time (optional)", exact: true })
  .click();
assert.equal(
  await page.getByLabel("End time date", { exact: true }).inputValue(),
  "2026-08-29",
);
assert.equal(
  await page.getByLabel("End time time", { exact: true }).inputValue(),
  "00:10",
);
await page.getByLabel("End time time", { exact: true }).fill("00:25");
await page
  .getByRole("button", { name: "✓ End time recorded", exact: true })
  .click();
await page
  .getByRole("button", { name: "+ Add end time (optional)", exact: true })
  .click();
assert.equal(
  await page.getByLabel("End time time", { exact: true }).inputValue(),
  "00:25",
);
await page.getByLabel("Close editor", { exact: true }).click();
await page.getByRole("button", { name: "+ Add", exact: true }).first().click();
await page.getByRole("button", { name: "Start timer", exact: true }).click();
await page.getByRole("button", { name: "Stop", exact: true }).waitFor();
const runningFeed = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("little-days-v1")).entries.find(
    (e) => e.feedRunning,
  ),
);
assert.ok(runningFeed && !runningFeed.end);
await page.reload();
await page.getByRole("button", { name: "停止", exact: true }).waitFor();
await page.getByText("正在喂养", { exact: true }).waitFor();
await page.getByRole("button", { name: "停止", exact: true }).click();
await page
  .getByText(`原选奶量：${runningFeed.amount} mL`, { exact: true })
  .waitFor();
assert.equal(
  await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("little-days-v1")).entries.find(
        (e) => e.id === id,
      ).feedRunning,
    runningFeed.id,
  ),
  true,
);
await page.getByRole("button", { name: "取消，继续喂养", exact: true }).click();
await page.getByRole("button", { name: "停止", exact: true }).click();
await page
  .getByText(`实际奶量：${runningFeed.amount} mL`, { exact: true })
  .waitFor();
const stopClickedAt = Date.now();
await page
  .getByLabel("奶量滚轮", { exact: true })
  .evaluate((element, amount) => {
    element.scrollTop = (amount / 5 + 2) * 44;
  }, runningFeed.amount);
await page
  .getByText(`实际奶量：${runningFeed.amount + 10} mL`, { exact: true })
  .waitFor();
await page.getByRole("button", { name: "减少奶量", exact: true }).click();
await page
  .getByText(`实际奶量：${runningFeed.amount + 5} mL`, { exact: true })
  .waitFor();
await page.getByRole("button", { name: "减少奶量", exact: true }).click();
await page.getByRole("button", { name: "增加奶量", exact: true }).click();
await page
  .getByText(`实际奶量：${runningFeed.amount + 5} mL`, { exact: true })
  .waitFor();
await page.waitForTimeout(350); // Let the modal's opening fade finish for visual review.
await page.screenshot({
  path: path.join(screenshotDir, "little-days-finish-feed.png"),
});
await page.evaluate(() => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === "little-days-v1") {
      Storage.prototype.setItem = original;
      throw new Error("Simulated full storage");
    }
    return original.call(this, key, value);
  };
});
await page.getByRole("button", { name: "确认并保存", exact: true }).click();
await page
  .getByText("保存失败，请重试；喂养记录尚未结束。", { exact: true })
  .waitFor();
assert.equal(
  await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("little-days-v1")).entries.find(
        (e) => e.id === id,
      ).feedRunning,
    runningFeed.id,
  ),
  true,
);
await page.getByRole("button", { name: "确认并保存", exact: true }).click();
await page
  .getByRole("button", { name: "＋记录", exact: true })
  .first()
  .waitFor();
const finishedFeed = await page.evaluate(
  (id) =>
    JSON.parse(localStorage.getItem("little-days-v1")).entries.find(
      (e) => e.id === id,
    ),
  runningFeed.id,
);
assert.equal(finishedFeed.feedRunning, undefined);
assert.equal(finishedFeed.amount, runningFeed.amount + 5);
assert.ok(
  Date.parse(finishedFeed.end) <= stopClickedAt + 1000,
  "end time is captured at Stop, not confirmation",
);
assert.equal(finishedFeed.start, runningFeed.start);
assert.ok(Date.parse(finishedFeed.end) >= Date.parse(finishedFeed.start));
await page.getByRole("tab", { name: "记录", exact: true }).click();
await page.getByRole("heading", { name: /^今天 · / }).waitFor();
await page.getByRole("button", { name: "编辑喂奶", exact: true }).waitFor();
assert.equal(
  await page.getByRole("button", { name: "编辑喂奶", exact: true }).count(),
  1,
);
await page.getByRole("tab", { name: "照护", exact: true }).click();
await page.getByRole("heading", { name: "照护", exact: true }).waitFor();
await page.getByRole("button", { name: "早教", exact: true }).click();
await page
  .getByRole("checkbox", { name: "今天做过：看看黑白卡", exact: true })
  .waitFor();
assert.equal(await page.getByRole("button", { name: /^查看/ }).count(), 7);
assert.equal(
  await page.getByRole("button", { name: /个月$/, exact: false }).count(),
  0,
); // no age filter on the daily list
await page.getByRole("button", { name: "设置早教", exact: true }).click();
await page
  .getByRole("checkbox", { name: "选择早教活动：看看黑白卡", exact: true })
  .click();
await page.getByRole("button", { name: "19–21 个月", exact: true }).click();
await page
  .getByRole("checkbox", { name: "选择早教活动：今天穿哪一件？", exact: true })
  .click();
await page
  .getByText("宝宝实际满 2 个月，这项活动不在当前参考月龄内。", { exact: true })
  .waitFor();
assert.equal(
  await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("little-days-v1-play-selection"),
    ).included.includes("choose-shirt"),
  ),
  false,
);
await page.getByRole("button", { name: "暂不加入", exact: true }).click();
await page
  .getByRole("checkbox", {
    name: "选择早教活动：今天穿哪一件？",
    checked: false,
  })
  .waitFor();
await page
  .getByRole("checkbox", { name: "选择早教活动：今天穿哪一件？", exact: true })
  .click();
await page.getByRole("button", { name: "仍然加入", exact: true }).click();
await page
  .getByRole("checkbox", {
    name: "选择早教活动：今天穿哪一件？",
    checked: true,
  })
  .waitFor();
await page.getByRole("button", { name: "早教", exact: true }).click();
assert.equal(await page.getByRole("button", { name: /^查看/ }).count(), 7);
assert.equal(
  await page
    .getByRole("button", { name: "查看看看黑白卡", exact: true })
    .count(),
  0,
);
await page
  .getByRole("button", { name: "查看今天穿哪一件？", exact: true })
  .waitFor();
await page.reload();
await page.getByRole("tab", { name: "照护", exact: true }).click();
await page.getByRole("button", { name: "早教", exact: true }).click();
await page
  .getByRole("button", { name: "查看今天穿哪一件？", exact: true })
  .waitFor();
assert.equal(
  await page
    .getByRole("button", { name: "查看看看黑白卡", exact: true })
    .count(),
  0,
);
await page.getByRole("tab", { name: "我的", exact: true }).click();
await chooseEnglish();
await page.getByRole("tab", { name: "Care", exact: true }).click();
await page.getByRole("button", { name: "Play settings", exact: true }).click();
await page.getByRole("button", { name: "19–21 months", exact: true }).click();
const playCount = await page.getByRole("button", { name: /^View / }).count();
assert.ok(playCount >= 6);
for (let i = 0; i < playCount; i++) {
  await page
    .getByRole("button", { name: /^(View|Hide) / })
    .nth(i)
    .click();
  await assertNoUntranslatedChinese("Play settings");
}
await page
  .getByRole("checkbox", {
    name: "Select play activity: Roll a ball together",
    exact: true,
  })
  .click();
await page.getByText("Confirm play activity", { exact: true }).waitFor();
await assertNoUntranslatedChinese("Cross-age selection confirmation");
await page.getByText(/Activity reference age: 18 to under 25 months/).waitFor();
await page.screenshot({
  path: path.join(screenshotDir, "little-days-selection-warning.png"),
});
await page.getByRole("button", { name: "Not now", exact: true }).click();
await page
  .getByText("Confirm play activity", { exact: true })
  .waitFor({ state: "hidden" });
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  true,
);
await page.screenshot({
  path: path.join(screenshotDir, "little-days-choose-activities.png"),
});
// A corrupt selection must not be overwritten by computed defaults.
await page.evaluate(() =>
  localStorage.setItem("little-days-v1-play-selection", "corrupt"),
);
await page.reload();
await page.getByRole("tab", { name: "照护", exact: true }).click();
await page.getByRole("button", { name: "早教", exact: true }).click();
await page
  .getByText("早教设置无法读取，原数据未覆盖。", { exact: true })
  .waitFor();
assert.equal(
  await page.evaluate(() =>
    localStorage.getItem("little-days-v1-play-selection"),
  ),
  "corrupt",
);
await page.evaluate(() =>
  localStorage.removeItem("little-days-v1-play-selection"),
);
await page
  .getByRole("button", { name: "重新读取早教设置", exact: true })
  .click();
await page
  .getByRole("checkbox", { name: "今天做过：看看黑白卡", exact: true })
  .waitFor();
await page.evaluate(() => {
  window.selectionSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === "little-days-v1-play-selection")
      throw new Error("simulated selection failure");
    return window.selectionSetItem.call(this, key, value);
  };
});
await page
  .getByRole("checkbox", { name: "选择早教活动：看看黑白卡", exact: true })
  .click();
await page.getByText("早教设置未保存，请重试。", { exact: true }).waitFor();
await page
  .getByRole("checkbox", { name: "选择早教活动：看看黑白卡", checked: true })
  .waitFor();
await page.evaluate(() => {
  Storage.prototype.setItem = window.selectionSetItem;
  delete window.selectionSetItem;
});
await context.setOffline(true);
await page
  .getByRole("checkbox", { name: "选择早教活动：看看黑白卡", exact: true })
  .click();
assert.equal(
  await page
    .getByRole("button", { name: "查看看看黑白卡", exact: true })
    .count(),
  0,
);
await page.getByRole("button", { name: "设置早教", exact: true }).click();
await page
  .getByRole("checkbox", { name: "选择早教活动：看看黑白卡", exact: true })
  .click();
await page
  .getByRole("checkbox", { name: "选择早教活动：看看黑白卡", checked: true })
  .waitFor();
await page.getByRole("button", { name: "早教", exact: true }).click();
// Check-ins remain independent of selection and persist across reload and midnight.
await page
  .getByRole("checkbox", { name: "今天做过：看看黑白卡", exact: true })
  .click();
await page
  .getByRole("checkbox", { name: "今天做过：看看黑白卡", checked: true })
  .waitFor();
await context.setOffline(false);
const checkinKey = await page.evaluate(() => {
  const d = new Date();
  return (
    "little-days-v1-play-checkins-" +
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
});
await page.reload();
await page.getByRole("tab", { name: "照护", exact: true }).click();
await page.getByRole("button", { name: "早教", exact: true }).click();
await page
  .getByRole("checkbox", { name: "今天做过：看看黑白卡", checked: true })
  .waitFor();
await page
  .getByRole("checkbox", { name: "选择早教活动：看看黑白卡", exact: true })
  .click();
await page.getByRole("button", { name: "设置早教", exact: true }).click();
await page
  .getByRole("checkbox", { name: "选择早教活动：看看黑白卡", exact: true })
  .click();
await page.getByRole("button", { name: "早教", exact: true }).click();
await page
  .getByRole("checkbox", { name: "今天做过：看看黑白卡", checked: true })
  .waitFor();
// A failed daily check-in write must still preserve the previous checked state.
await page.evaluate(() => {
  window.checkinSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key.includes("play-checkins-"))
      throw new Error("simulated check-in failure");
    return window.checkinSetItem.call(this, key, value);
  };
});
await page
  .getByRole("checkbox", { name: "今天做过：看看黑白卡", exact: true })
  .click();
await page.getByText("打卡未保存，请重试。", { exact: true }).waitFor();
await page
  .getByRole("checkbox", { name: "今天做过：看看黑白卡", checked: true })
  .waitFor();
await page.evaluate(() => {
  Storage.prototype.setItem = window.checkinSetItem;
  delete window.checkinSetItem;
});
// The browser uses Melbourne time; the CI Node process may use UTC. Advance
// the browser's calendar day, not the host's potentially different "tomorrow".
const nextDay = await page.evaluate(() => {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(0, 1, 0, 0);
  return next.getTime();
});
await page.clock.setFixedTime(nextDay);
await page
  .getByRole("checkbox", { name: "今天做过：看看黑白卡", checked: false })
  .waitFor();
assert.deepEqual(
  await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    checkinKey,
  ),
  ["contrast-card"],
);
await page.getByRole("tab", { name: "我的", exact: true }).click();
await chooseEnglish();
await page.getByRole("tab", { name: "Care", exact: true }).click();
await page.getByRole("button", { name: "Play", exact: true }).click();
await page
  .getByRole("button", { name: "View Awake tummy time", exact: true })
  .click();
await assertNoUntranslatedChinese("Selected activity list");
await page.getByRole("button", { name: "Play settings", exact: true }).click();
await page.getByRole("button", { name: "5–7 months", exact: true }).click();
for (const title of [
  "Gentle touch",
  "A gentle rattle",
  "Little kicks",
  "Mirror smiles",
]) {
  await page
    .getByRole("button", { name: `View ${title}`, exact: true })
    .click();
  await assertNoUntranslatedChinese(title);
  await page
    .getByRole("button", { name: `Hide ${title}`, exact: true })
    .click();
}
// Daily care is a separate history, not a daily play checkbox.
await page.getByRole("button", { name: "Daily care", exact: true }).click();
const playControls = [
  "Daily care",
  "Play",
  "Play settings",
  "Temp",
  "Bath",
  "Wash",
  "Teeth",
  "Nails",
  "Supplements",
];
const iconPaths = [];
for (const name of playControls) {
  const control = page.getByRole("button", { name, exact: true });
  assert.equal(await control.locator("svg").count(), 1);
  iconPaths.push(await control.locator("svg path").getAttribute("d"));
}
assert.equal(new Set(iconPaths).size, playControls.length);
for (const names of [playControls.slice(0, 3), playControls.slice(3)]) {
  const boxes = await page
    .getByRole("button", { name: new RegExp(`^(${names.join("|")})$`) })
    .evaluateAll((elements) =>
      elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
  assert.equal(boxes.length, names.length);
  assert.ok(
    boxes.every(
      (b) =>
        b.width >= 44 &&
        b.height >= 44 &&
        b.x >= 0 &&
        b.x + b.width <= page.viewportSize().width,
    ),
    `care choices must fit the screen with accessible touch targets: ${JSON.stringify(boxes)}`,
  );
  for (let index = 1; index < boxes.length; index++) {
    const current = boxes[index],
      previous = boxes[index - 1];
    assert.ok(
      current.x >= previous.x + previous.width ||
        current.y >= previous.y + previous.height,
      "care choices may wrap, but must preserve reading order without overlap",
    );
  }
}
await page
  .getByRole("button", { name: "Temp", exact: true })
  .scrollIntoViewIfNeeded();
await page.screenshot({
  path: path.join(screenshotDir, "little-days-care-icons-en.png"),
});
assert.equal(
  await page.getByRole("button", { name: "By setting", exact: true }).count(),
  0,
);
// The visible prefill must be a real editable value, saved without changing it.
assert.equal(
  await page
    .getByRole("textbox", { name: "Temperature · °C", exact: true })
    .inputValue(),
  "36.8",
);
assert.equal(
  await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("little-days-v1")).careRecords?.length ??
      0,
  ),
  0,
);
await page
  .getByRole("button", { name: "Save care record", exact: true })
  .click();
await page.getByText("Care record saved", { exact: true }).waitFor();
assert.deepEqual(saveDialogs.at(-1), {
  type: "alert",
  message: "Care record saved\n\nSaved on this device",
});
assert.deepEqual(
  await page.evaluate(() => {
    const records = JSON.parse(
      localStorage.getItem("little-days-v1"),
    ).careRecords;
    return [records.length, records[0].temperature, records[0].method];
  }),
  [1, 36.8, "armpit"],
);
assert.equal(
  await page
    .getByRole("textbox", { name: "Temperature · °C", exact: true })
    .inputValue(),
  "36.8",
);
for (const name of ["Edit care record", "Delete care record"]) {
  const action = page.getByRole("button", { name, exact: true });
  assert.equal(await action.locator("svg").count(), 1);
  assert.equal(await action.innerText(), "");
  const target = await action.boundingBox();
  assert.ok(target.width >= 44 && target.height >= 44);
}
await page
  .getByRole("button", { name: "Edit care record", exact: true })
  .click();
// Explicitly clearing the input must not silently save the default again.
await page
  .getByRole("textbox", { name: "Temperature · °C", exact: true })
  .fill("");
await page
  .getByRole("button", { name: "Save care record", exact: true })
  .click();
await page.getByText(/Check the date, time and reading/).waitFor();
assert.equal(
  await page
    .getByRole("textbox", { name: "Temperature · °C", exact: true })
    .inputValue(),
  "",
);
await page
  .getByRole("textbox", { name: "Temperature · °C", exact: true })
  .pressSequentially("36.85");
assert.equal(
  await page
    .getByRole("button", { name: "Armpit", exact: true })
    .getAttribute("aria-pressed"),
  "true",
);
assert.equal(
  await page
    .getByRole("textbox", { name: "Temperature · °C", exact: true })
    .getAttribute("inputmode"),
  "decimal",
);
await page
  .getByRole("textbox", { name: "Care notes", exact: true })
  .fill("after waking");
// Form changes must not write before Save.
assert.equal(
  await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("little-days-v1")).careRecords?.length ??
      0,
  ),
  1,
);
assert.equal(
  await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("little-days-v1")).careRecords[0]
        .temperature,
  ),
  36.8,
);
await page
  .getByRole("button", { name: "Save care record", exact: true })
  .click();
await page.getByText("Care record saved", { exact: true }).waitFor();
assert.equal(
  await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("little-days-v1")).careRecords[0]
        .temperature,
  ),
  36.85,
);
assert.equal(
  await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("little-days-v1")).careRecords[0].method,
  ),
  "armpit",
);
await page
  .getByRole("button", { name: "Edit care record", exact: true })
  .click();
await page
  .getByRole("textbox", { name: "Temperature · °C", exact: true })
  .fill("37,2");
await page
  .getByRole("button", { name: "Save care record", exact: true })
  .click();
await page.getByText("Care record saved", { exact: true }).waitFor();
assert.equal(
  await page.evaluate(
    () => JSON.parse(localStorage.getItem("little-days-v1")).careRecords.length,
  ),
  1,
);
assert.equal(
  await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("little-days-v1")).careRecords[0]
        .temperature,
  ),
  37.2,
);
for (let i = 0; i < 5; i++) {
  await page
    .getByRole("textbox", { name: "Temperature · °C", exact: true })
    .fill(String(36 + i / 10));
  await page.getByRole("button", { name: "Forehead", exact: true }).click();
  await page
    .getByRole("button", { name: "Save care record", exact: true })
    .click();
  await page.getByText("Care record saved", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Armpit", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
}
assert.equal(
  await page
    .getByRole("button", { name: "Delete care record", exact: true })
    .count(),
  3,
);
await page
  .getByRole("button", { name: "Show 3 older care records", exact: true })
  .click();
assert.equal(
  await page
    .getByRole("button", { name: "Delete care record", exact: true })
    .count(),
  6,
);
// Editing an older non-armpit reading must retain its actual measurement site.
await page
  .getByRole("button", { name: "Edit care record", exact: true })
  .last()
  .click();
assert.equal(
  await page
    .getByRole("button", { name: "Forehead", exact: true })
    .getAttribute("aria-pressed"),
  "true",
);
await page.getByRole("button", { name: "Cancel edit", exact: true }).click();
assert.equal(
  await page
    .getByRole("button", { name: "Armpit", exact: true })
    .getAttribute("aria-pressed"),
  "true",
);
await page
  .getByRole("button", { name: "Delete care record", exact: true })
  .last()
  .click();
assert.equal(
  await page.evaluate(
    () => JSON.parse(localStorage.getItem("little-days-v1")).careRecords.length,
  ),
  6,
);
await page
  .getByRole("button", { name: "Cancel deletion", exact: true })
  .click();
await page
  .getByRole("button", { name: "Delete care record", exact: true })
  .last()
  .click();
await page
  .getByRole("button", { name: "Confirm care deletion", exact: true })
  .click();
await page.getByText("Care record deleted", { exact: true }).waitFor();
assert.equal(
  await page.evaluate(
    () => JSON.parse(localStorage.getItem("little-days-v1")).careRecords.length,
  ),
  5,
);
await page.getByRole("button", { name: "Bath", exact: true }).click();
await page
  .getByRole("button", { name: "Save care record", exact: true })
  .click();
await page.getByText("Care record saved", { exact: true }).waitFor();
await assertNoUntranslatedChinese("Bath care");
await page.getByRole("button", { name: "Temp", exact: true }).click();
assert.equal(
  await page
    .getByRole("button", { name: "Delete care record", exact: true })
    .count(),
  3,
);
await page
  .getByRole("button", { name: "Show 2 older care records", exact: true })
  .waitFor();
for (const kind of ["Wash", "Teeth", "Nails"]) {
  await page.getByRole("button", { name: kind, exact: true }).click();
  await assertNoUntranslatedChinese(`Daily care ${kind}`);
}
await page.getByRole("button", { name: "Temp", exact: true }).click();
await page.evaluate(() => {
  window.careSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === "little-days-v1")
      throw new Error("simulated care save failure");
    return window.careSetItem.call(this, key, value);
  };
});
await page
  .getByRole("textbox", { name: "Temperature · °C", exact: true })
  .fill("36.9");
await page.getByRole("button", { name: "Armpit", exact: true }).click();
await page
  .getByRole("button", { name: "Save care record", exact: true })
  .click();
await page
  .getByText("Care record was not saved. Please try again.", { exact: true })
  .waitFor();
assert.equal(
  await page.evaluate(
    () => JSON.parse(localStorage.getItem("little-days-v1")).careRecords.length,
  ),
  6,
);
await page.evaluate(() => {
  Storage.prototype.setItem = window.careSetItem;
  delete window.careSetItem;
});
await page.reload();
await page.getByRole("tab", { name: "照护", exact: true }).click();
await page.getByRole("button", { name: "日常", exact: true }).click();
assert.equal(
  await page.getByRole("button", { name: "删除照护记录", exact: true }).count(),
  3,
);
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  true,
);
await page.screenshot({
  path: path.join(screenshotDir, "little-days-daily-care.png"),
});
await page.getByRole("tab", { name: "我的", exact: true }).click();
await page.getByRole("button", { name: "展开备份与恢复", exact: true }).click();
const careDownloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "导出备份文件", exact: true }).click();
const careDownload = await careDownloadPromise;
const careBackupBytes = await fs.readFile(await careDownload.path());
const careBackup = JSON.parse(careBackupBytes.toString());
assert.equal(careBackup.careRecords.length, 6);
const beforeFamilyImport = await page.evaluate(() =>
  localStorage.getItem("little-days-v1"),
);
const familyImportMessage =
  "这是家庭共享记录导出文件。为保护家庭隐私，不能将其导入个人记录或共享家庭，离线时也不支持。现有记录未改变。";
for (const offline of [false, true]) {
  await context.setOffline(offline);
  const familyChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "选择备份文件", exact: true }).click();
  await (
    await familyChooserPromise
  ).setFiles({
    name: "little-days-family-test.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "my-little-days-family-backup",
        formatVersion: 1,
        profile: careBackup.profile,
        entries: [],
      }),
    ),
  });
  await page
    .getByRole("alert")
    .filter({ hasText: familyImportMessage })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "确认替换当前数据", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("little-days-v1")),
    beforeFamilyImport,
  );
}
// A normal personal backup remains importable offline after the rejection.
const careChooserPromise = page.waitForEvent("filechooser");
await page.getByRole("button", { name: "选择备份文件", exact: true }).click();
await (
  await careChooserPromise
).setFiles({
  name: "care-backup.json",
  mimeType: "application/json",
  buffer: careBackupBytes,
});
await page
  .getByRole("button", { name: "确认替换当前数据", exact: true })
  .click();
assert.equal(
  await page.getByText(familyImportMessage, { exact: true }).count(),
  0,
);
await context.setOffline(false);
await page.getByRole("tab", { name: "照护", exact: true }).click();
await page.getByRole("button", { name: "日常", exact: true }).click();
assert.equal(
  await page.getByRole("button", { name: "删除照护记录", exact: true }).count(),
  3,
);
assert.deepEqual(
  await page.evaluate(
    () => JSON.parse(localStorage.getItem("little-days-v1")).careRecords,
  ),
  careBackup.careRecords,
);
await page.evaluate(() => localStorage.setItem("little-days-v1-dark", "true"));
await page.reload();
await page.getByRole("tab", { name: "照护", exact: true }).click();
await page.getByRole("button", { name: "日常", exact: true }).click();
await context.setOffline(true);
await page
  .getByRole("textbox", { name: "体温 · °C", exact: true })
  .fill("３６．７");
await page.getByRole("button", { name: "保存照护记录", exact: true }).click();
await page.getByText("照护记录已保存", { exact: true }).waitFor();
assert.deepEqual(saveDialogs.at(-1), {
  type: "alert",
  message: "照护记录已保存\n\n已保存到本机",
});
assert.equal(
  await page.evaluate(
    () => JSON.parse(localStorage.getItem("little-days-v1")).careRecords.length,
  ),
  7,
);
await context.setOffline(false);
await page.screenshot({
  path: path.join(screenshotDir, "little-days-daily-care-dark.png"),
});
// Formula shortcuts follow age on the feed date without replacing actual intake.
await page.setViewportSize({ width: 320, height: 844 });
const feedDates = await page.evaluate(() => {
  const today = new Date();
  const asDate = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const birth = new Date(today);
  birth.setDate(birth.getDate() - 14);
  const firstWeek = new Date(birth);
  firstWeek.setDate(firstWeek.getDate() + 6);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  localStorage.setItem(
    "little-days-v1",
    JSON.stringify({
      schemaVersion: 1,
      profile: { name: "Baby", birthDate: asDate(birth), sex: "unspecified" },
      entries: [],
    }),
  );
  return { firstWeek: asDate(firstWeek), yesterday: asDate(yesterday) };
});
await page.reload();
await page.getByRole("tab", { name: "我的", exact: true }).click();
await chooseEnglish();
await page.getByRole("tab", { name: "Today", exact: true }).click();
await page.getByRole("button", { name: "+ Add", exact: true }).first().click();
async function assertAmountShortcuts(expected) {
  const buttons = page.getByRole("button", { name: /^\d+ mL$/ });
  assert.deepEqual(
    await buttons.allTextContents(),
    expected.map((n) => `${n} mL`),
  );
  const boxes = await buttons.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
  assert.ok(
    boxes.every(
      (box) =>
        Math.abs(box.y - boxes[0].y) < 1 &&
        box.x >= 0 &&
        box.x + box.width <= 320 &&
        box.height >= 44,
    ),
    `age-aware amount shortcuts must remain on one row with usable touch targets: ${JSON.stringify(boxes)}`,
  );
}
async function waitForFeedEditor(closeLabel) {
  await page.getByLabel(closeLabel, { exact: true }).waitFor();
  await page.waitForFunction((label) => {
    const close = document.querySelector(`[aria-label="${label}"]`);
    return close && close.getBoundingClientRect().top <= 24;
  }, closeLabel);
}
await waitForFeedEditor("Close editor");
await page.getByText(/Quick amounts for age at feed \(14 days\)/).waitFor();
await assertAmountShortcuts([30, 60, 90, 120]);
assert.equal(
  await page.getByLabel("Amount fed", { exact: true }).inputValue(),
  "120",
);
await page
  .getByRole("link", { name: "Formula feeding guide · AAP ↗", exact: true })
  .waitFor();
await assertNoUntranslatedChinese("age-aware feed editor");
await page.getByLabel("Amount fed", { exact: true }).scrollIntoViewIfNeeded();
for (const label of ["Time date", "Time time"]) {
  const box = await page.getByLabel(label, { exact: true }).boundingBox();
  assert.ok(
    box && box.x >= 0 && box.x + box.width <= 320,
    `${label} must fit a narrow screen`,
  );
}
await page.screenshot({
  path: path.join(screenshotDir, "little-days-feed-presets-en-dark.png"),
});
await page.getByLabel("Amount fed", { exact: true }).fill("57.5");
await page.getByLabel("Time date", { exact: true }).fill(feedDates.firstWeek);
await assertAmountShortcuts([15, 30, 45, 60]);
assert.equal(
  await page.getByLabel("Amount fed", { exact: true }).inputValue(),
  "57.5",
);
await page
  .getByRole("button", { name: "Feeding method: Bottle", exact: true })
  .click();
await assertAmountShortcuts([60, 90, 120, 150]);
assert.equal(
  await page.getByLabel("Amount fed", { exact: true }).inputValue(),
  "57.5",
);
assert.equal(await page.getByText(/Quick amounts for age at feed/).count(), 0);
await page
  .getByRole("button", { name: "Feeding method: Left side", exact: true })
  .click();
assert.equal(await page.getByLabel("Amount fed", { exact: true }).count(), 0);
await page
  .getByRole("button", { name: "Feeding method: Formula", exact: true })
  .click();
await assertAmountShortcuts([15, 30, 45, 60]);
assert.equal(
  await page.getByLabel("Amount fed", { exact: true }).inputValue(),
  "57.5",
);
await page.getByLabel("Time date", { exact: true }).fill(feedDates.yesterday);
await page.getByLabel("Time time", { exact: true }).fill("10:00");
await assertAmountShortcuts([30, 60, 90, 120]);
await page.getByRole("button", { name: "60 mL", exact: true }).click();
await page
  .getByRole("button", { name: "+ Add end time (optional)", exact: true })
  .click();
await page.getByRole("button", { name: "Save record", exact: true }).click();
await page
  .getByLabel("Close editor", { exact: true })
  .waitFor({ state: "detached" });
assert.equal(
  await page.evaluate(
    () => JSON.parse(localStorage.getItem("little-days-v1")).entries[0].amount,
  ),
  60,
);
await page.evaluate(() => localStorage.setItem("little-days-v1-dark", "false"));
await page.reload();
await page.getByRole("tab", { name: "记录", exact: true }).click();
await page
  .getByRole("button", { name: "展开当日明细", exact: true })
  .first()
  .click();
await page
  .getByRole("button", { name: "编辑喂奶", exact: true })
  .first()
  .click();
await waitForFeedEditor("关闭记录编辑");
await page.getByText(/按喂养当天日龄（13天）/).waitFor();
assert.equal(
  await page.getByLabel("实际喝奶量", { exact: true }).inputValue(),
  "60",
);
await assertAmountShortcuts([30, 60, 90, 120]);
await page.getByLabel("实际喝奶量", { exact: true }).scrollIntoViewIfNeeded();
await page.screenshot({
  path: path.join(screenshotDir, "little-days-feed-presets-zh-light.png"),
});
await page.getByLabel("关闭记录编辑", { exact: true }).click();
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("little-days-v1"));
  state.profile.birthDate = "";
  localStorage.setItem("little-days-v1", JSON.stringify(state));
});
await page.reload();
await page.getByRole("button", { name: "＋记录", exact: true }).first().click();
await waitForFeedEditor("关闭记录编辑");
await assertAmountShortcuts([60, 90, 120, 150]);
assert.equal(
  await page.getByLabel("实际喝奶量", { exact: true }).inputValue(),
  "120",
);
assert.equal(await page.getByText(/按喂养当天日龄/).count(), 0);
await page.getByLabel("关闭记录编辑", { exact: true }).click();
// Calendar is the initial view; all types share a timeline and real edit/delete flows.
const calendarDate = await page.evaluate(() => {
  const day = new Date();
  day.setDate(day.getDate() - 1);
  day.setHours(0, 0, 0, 0);
  const at = (hour, minute = 0) =>
    new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      hour,
      minute,
    ).toISOString();
  const previous = new Date(day);
  previous.setHours(-1);
  localStorage.removeItem("little-days-v1-record-view");
  localStorage.setItem("little-days-v1-dark", "true");
  localStorage.setItem(
    "little-days-v1",
    JSON.stringify({
      schemaVersion: 1,
      profile: { name: "Baby", birthDate: "", sex: "unspecified" },
      entries: [
        {
          id: "calendar-feed-60",
          type: "feed",
          feedKind: "formula",
          amount: 60,
          start: at(9),
          end: at(9, 20),
          note: "Calendar feed note",
        },
        {
          id: "calendar-feed-90",
          type: "feed",
          feedKind: "expressed",
          amount: 90,
          start: at(9),
          end: at(9, 30),
          note: "",
        },
        {
          id: "calendar-nappy",
          type: "diaper",
          diaperKind: "wet",
          start: at(9),
          note: "",
        },
        {
          id: "calendar-nappy-2",
          type: "diaper",
          diaperKind: "dirty",
          start: at(11),
          note: "",
        },
        {
          id: "calendar-nappy-3",
          type: "diaper",
          diaperKind: "mixed",
          start: at(18),
          note: "",
        },
        {
          id: "calendar-night",
          type: "sleep",
          start: previous.toISOString(),
          end: at(2),
          note: "Crosses midnight",
        },
        {
          id: "calendar-nap",
          type: "sleep",
          start: at(14),
          end: at(15),
          note: "",
        },
      ],
    }),
  );
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
});
await page.reload();
await page.getByRole("tab", { name: "我的", exact: true }).click();
await chooseEnglish();
await page.getByRole("tab", { name: "Records", exact: true }).click();
assert.equal(
  await page
    .getByRole("button", { name: "Bar chart", exact: true })
    .getAttribute("aria-selected"),
  "true",
);
await page.getByRole("button", { name: "Calendar", exact: true }).click();
async function assertCompactCalendarToolbar(labels) {
  const boxes = await Promise.all(
    labels.map((name) =>
      page.getByRole("button", { name, exact: true }).boundingBox(),
    ),
  );
  assert.ok(boxes.every((box) => box && box.width >= 44 && box.height >= 44));
  assert.ok(
    boxes.slice(0, 3).every((box) => Math.abs(box.y - boxes[0].y) <= 2),
    "day, week and today should share one row",
  );
  assert.ok(
    boxes
      .slice(0, 3)
      .every(
        (box, index) =>
          index === 0 || box.x >= boxes[index - 1].x + boxes[index - 1].width,
      ),
    "calendar tools stay left aligned",
  );
  const title = await page
    .getByRole("heading", { name: /^(Records|记录)$/ })
    .boundingBox();
  assert.ok(title && title.x + title.width <= boxes[3].x);
  assert.ok(
    Math.abs(title.y + title.height / 2 - (boxes[3].y + boxes[3].height / 2)) <=
      2,
    "view toggle is vertically centered beside the title",
  );
  assert.ok(Math.abs(boxes[3].y - boxes[4].y) <= 2);
  assert.ok(boxes[3].x + boxes[3].width <= boxes[4].x);
  assert.ok(
    boxes[3].y + boxes[3].height <= boxes[0].y,
    "title toggle is above calendar tools",
  );
  assert.ok(
    boxes.at(-1).x + boxes.at(-1).width <= page.viewportSize().width - 18,
  );
}
await assertCompactCalendarToolbar([
  "Day",
  "Week",
  "Today",
  "Calendar",
  "Bar chart",
]);
assert.equal(
  await page.getByRole("button", { name: "Calendar", exact: true }).innerText(),
  "",
);
await page
  .getByRole("button", { name: "Choose calendar date", exact: true })
  .click();
await page.getByLabel("Calendar date", { exact: true }).fill(calendarDate);
await page.getByRole("button", { name: "Go to date", exact: true }).click();
assert.equal(
  await page.getByRole("button", { name: /^View record:/ }).count(),
  7,
);
await page
  .getByText("150 mL · 3 nappies · Sleep 3h 0m", { exact: true })
  .waitFor();
const compactFilter = page.getByRole("button", {
  name: "Filter records: All",
  exact: true,
});
const compactFilterBox = await compactFilter.boundingBox();
const calendarDayBox = await page
  .getByRole("button", { name: "Day", exact: true })
  .boundingBox();
assert.ok(
  compactFilterBox &&
    calendarDayBox &&
    Math.abs(compactFilterBox.y - calendarDayBox.y) < 2,
);
assert.ok(compactFilterBox.width >= 44 && compactFilterBox.height >= 44);
for (const [label, count] of [
  ["Feed", 2],
  ["Sleep", 2],
  ["Diaper", 3],
  ["All", 7],
]) {
  await page.getByRole("button", { name: /^Filter records:/ }).click();
  await page
    .getByRole("button", { name: `Filter: ${label}`, exact: true })
    .click();
  assert.equal(
    await page.getByRole("button", { name: /^View record:/ }).count(),
    count,
  );
}
await compactFilter.click();
await page.getByRole("button", { name: "Close filters", exact: true }).click();
// The modal and inline toolbar reuse filter labels. Finish dismissing the
// modal before resizing, or the next locator can resolve a departing button.
await page
  .getByRole("button", { name: "Close filters", exact: true })
  .waitFor({ state: "detached" });
assert.equal(
  await page.getByRole("button", { name: /^View record:/ }).count(),
  7,
);
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Filter: All", exact: true }).waitFor();
const fullFilterBoxes = await Promise.all(
  ["All", "Feed", "Diaper", "Sleep"].map((label) =>
    page
      .getByRole("button", { name: `Filter: ${label}`, exact: true })
      .boundingBox(),
  ),
);
const fullDayBox = await page
  .getByRole("button", { name: "Day", exact: true })
  .boundingBox();
assert.ok(
  fullFilterBoxes.every(
    (box) =>
      box &&
      box.width >= 44 &&
      box.height >= 44 &&
      Math.abs(box.y - fullDayBox.y) < 2,
  ),
  JSON.stringify({ fullFilterBoxes, fullDayBox }),
);
assert.ok(fullFilterBoxes[3].x + fullFilterBoxes[3].width <= 372);
await page.getByRole("button", { name: "Filter: Sleep", exact: true }).click();
assert.equal(
  await page.getByRole("button", { name: /^View record:/ }).count(),
  2,
);
await page.screenshot({
  path: path.join(screenshotDir, "little-days-calendar-filter-en.png"),
});
await page.setViewportSize({ width: 320, height: 844 });
await page
  .getByRole("button", { name: "Filter records: Sleep", exact: true })
  .click();
await page.getByRole("button", { name: "Filter: All", exact: true }).click();
assert.equal(
  await page.getByRole("button", { name: /^View record:/ }).count(),
  7,
);
assert.equal(
  await page.getByRole("button", { name: /^Open calendar record:/ }).count(),
  3,
);
await page
  .getByRole("button", { name: "Show 4 older entries", exact: true })
  .click();
assert.equal(
  await page.getByRole("button", { name: /^Open calendar record:/ }).count(),
  7,
);
await page
  .getByRole("button", { name: "View record: Feed 60 mL · 09:00", exact: true })
  .click();
await page.getByText("Calendar feed note", { exact: true }).waitFor();
await page.getByRole("button", { name: "Edit record", exact: true }).click();
await waitForFeedEditor("Close editor");
await page.getByLabel("Amount fed", { exact: true }).fill("75");
await page.getByRole("button", { name: "Save record", exact: true }).click();
await page
  .getByLabel("Close editor", { exact: true })
  .waitFor({ state: "detached" });
await page
  .getByRole("button", { name: "View record: Feed 75 mL · 09:00", exact: true })
  .waitFor();
await page
  .getByRole("button", { name: "View record: Pee · 09:00", exact: true })
  .click();
await page.getByRole("button", { name: "Delete record", exact: true }).click();
await page.getByRole("button", { name: "Cancel", exact: true }).click();
assert.equal(
  await page.getByRole("button", { name: /^View record:/ }).count(),
  7,
);
await page
  .getByRole("button", { name: "View record: Pee · 09:00", exact: true })
  .click();
await page.getByRole("button", { name: "Delete record", exact: true }).click();
await page.getByRole("button", { name: "Delete record", exact: true }).click();
await page
  .getByRole("button", { name: "View record: Pee · 09:00", exact: true })
  .waitFor({ state: "detached" });
assert.equal(
  await page.evaluate(
    () => JSON.parse(localStorage.getItem("little-days-v1")).entries.length,
  ),
  6,
);
await page.getByRole("button", { name: "Week", exact: true }).click();
assert.ok(
  (await page.getByRole("button", { name: /^View record:/ }).count()) >= 6,
);
await assertNoUntranslatedChinese("calendar week and details");
await page.getByRole("button", { name: "Day", exact: true }).click();
await page
  .getByRole("button", { name: "Choose calendar date", exact: true })
  .scrollIntoViewIfNeeded();
await page.screenshot({
  path: path.join(screenshotDir, "little-days-calendar-en-dark.png"),
});
await page.getByRole("button", { name: "Bar chart", exact: true }).click();
await page.getByRole("button", { name: "Sleep", exact: true }).click();
await page.getByRole("button", { name: "1 month", exact: true }).click();
await page.getByRole("button", { name: "Calendar", exact: true }).click();
await page.getByRole("button", { name: "Bar chart", exact: true }).click();
assert.equal(
  await page
    .getByRole("button", { name: "Sleep", exact: true })
    .getAttribute("aria-selected"),
  "true",
);
assert.equal(
  await page
    .getByRole("button", { name: "1 month", exact: true })
    .getAttribute("aria-selected"),
  "true",
);
assert.equal(
  await page.evaluate(() => localStorage.getItem("little-days-v1-record-view")),
  null,
);
await page.getByRole("tab", { name: "More", exact: true }).click();
await page
  .getByRole("button", { name: "Expand Default Records view", exact: true })
  .click();
await page.getByRole("radio", { name: "Bar chart", exact: true }).click();
assert.equal(
  await page.evaluate(() => localStorage.getItem("little-days-v1-record-view")),
  "bars",
);
await page.getByRole("tab", { name: "Records", exact: true }).click();
assert.equal(
  await page
    .getByRole("button", { name: "Bar chart", exact: true })
    .getAttribute("aria-selected"),
  "true",
);
await page.getByRole("button", { name: "Calendar", exact: true }).click();
await page.getByRole("tab", { name: "Today", exact: true }).click();
await page.getByRole("tab", { name: "Records", exact: true }).click();
assert.equal(
  await page
    .getByRole("button", { name: "Bar chart", exact: true })
    .getAttribute("aria-selected"),
  "true",
);
const versionConfig = JSON.parse(await fs.readFile("app.json", "utf8")).expo;
assert.equal(
  await page.getByLabel("App version", { exact: true }).innerText(),
  `Version ${versionConfig.version} · Update ${versionConfig.ios.buildNumber}`,
);
await page.reload();
await page.getByRole("tab", { name: "记录", exact: true }).click();
assert.equal(
  await page
    .getByRole("button", { name: "柱状图", exact: true })
    .getAttribute("aria-selected"),
  "true",
);
await page.getByRole("button", { name: "日历视图", exact: true }).click();
await assertCompactCalendarToolbar([
  "日",
  "周",
  "回到今天",
  "日历视图",
  "柱状图",
]);
await page.getByRole("button", { name: "选择日历日期", exact: true }).click();
await page.getByLabel("日历日期", { exact: true }).fill(calendarDate);
await page.getByRole("button", { name: "前往日期", exact: true }).click();
assert.equal(
  await page.getByRole("button", { name: /^查看记录：/ }).count(),
  6,
);
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  true,
);
await page
  .getByRole("button", { name: "选择日历日期", exact: true })
  .scrollIntoViewIfNeeded();
await page.screenshot({
  path: path.join(screenshotDir, "little-days-calendar-zh.png"),
});
await page.getByRole("button", { name: "筛选记录：全部", exact: true }).click();
await page.getByRole("button", { name: "筛选：尿布", exact: true }).click();
assert.equal(
  await page.getByRole("button", { name: /^查看记录：/ }).count(),
  2,
);
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "筛选：尿布", exact: true }).waitFor();
assert.equal(
  await page
    .getByRole("button", { name: "筛选：尿布", exact: true })
    .getAttribute("aria-selected"),
  "true",
);
await page.getByRole("button", { name: "筛选：全部", exact: true }).click();
assert.equal(
  await page.getByRole("button", { name: /^查看记录：/ }).count(),
  6,
);
await page.screenshot({
  path: path.join(screenshotDir, "little-days-calendar-filter-zh.png"),
});
// Account setup lives directly in More. Signed-out users must not have a
// family-management entry or need another navigation step to see setup status.
const localHistoryBeforePilot = await page.evaluate(() =>
  localStorage.getItem("little-days-v1"),
);
await page.getByRole("tab", { name: "我的", exact: true }).click();
await page.getByRole("heading", { name: "我的账户", exact: true }).waitFor();
assert.equal(
  await page.getByRole("button", { name: "家庭共享", exact: true }).count(),
  0,
);
assert.equal(
  await page.getByRole("button", { name: "管理家庭共享", exact: true }).count(),
  0,
);
await page.getByText("家庭服务尚未配置", { exact: true }).waitFor();
assert.equal(
  await page.getByRole("button", { name: "登录", exact: true }).count(),
  0,
);
await page.setViewportSize({ width: 320, height: 740 });
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  true,
);
await chooseEnglish();
await page.getByRole("heading", { name: "My account", exact: true }).waitFor();
assert.equal(
  await page
    .getByRole("button", { name: "Family sharing", exact: true })
    .count(),
  0,
);
await page
  .getByText("Family service is not configured", { exact: true })
  .waitFor();
assert.equal(
  await page.getByRole("button", { name: "Login", exact: true }).count(),
  0,
);
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  true,
);
assert.equal(
  await page.evaluate(() => localStorage.getItem("little-days-v1")),
  localHistoryBeforePilot,
);
await page.getByRole("tab", { name: "Records", exact: true }).click();
await page.getByRole("button", { name: "Calendar", exact: true }).click();
await page
  .getByRole("button", { name: "Choose calendar date", exact: true })
  .click();
await page.getByLabel("Calendar date", { exact: true }).fill(calendarDate);
await page.getByRole("button", { name: "Go to date", exact: true }).click();
assert.equal(
  await page.getByRole("button", { name: /^View record:/ }).count(),
  6,
);
// Live sleep responds locally, rejects accidental sub-minute sessions, and
// keeps the manual backfill path unrestricted. Use an isolated synthetic state.
const sleepClock = new Date("2026-09-17T03:14:00+10:00");
await page.clock.setFixedTime(sleepClock);
await page.evaluate(() => {
  localStorage.setItem("little-days-v1-language", "zh");
  localStorage.setItem(
    "little-days-v1",
    JSON.stringify({
      schemaVersion: 1,
      profile: { name: "Sleep test", birthDate: "", sex: "unspecified" },
      entries: [],
    }),
  );
});
await page.reload();
await page.getByText("今日数据", { exact: true }).waitFor();
assert.equal(await page.getByText("0", { exact: true }).count(), 3);
await page.getByRole("button", { name: "睡了", exact: true }).click();
await page.getByText("正在睡觉", { exact: true }).waitFor();
await page.getByRole("button", { name: "醒了", exact: true }).waitFor();
await page.reload();
await page.getByText("正在睡觉", { exact: true }).waitFor();
await page.clock.setFixedTime(new Date(sleepClock.getTime() + 59_999));
await page.getByRole("button", { name: "醒了", exact: true }).click();
await page
  .getByText(
    "本次睡眠不足 1 分钟，已按误触取消，不计入记录。如需保留，请补录睡眠。",
    { exact: true },
  )
  .waitFor();
assert.equal(await page.getByText("正在睡觉", { exact: true }).count(), 0);
assert.equal(
  await page.evaluate(
    () => JSON.parse(localStorage.getItem("little-days-v1")).entries.length,
  ),
  0,
);
assert.equal(await page.getByText("0", { exact: true }).count(), 3);

// An explicitly backfilled zero-minute record is allowed, unlike live reversal.
await page.getByRole("button", { name: "补录睡眠 ›", exact: true }).click();
await page.getByLabel("醒来时间日期", { exact: true }).waitFor();
await page.getByLabel("入睡时间日期", { exact: true }).fill("2026-09-17");
await page.getByLabel("入睡时间时刻", { exact: true }).fill("03:10");
await page.getByLabel("醒来时间日期", { exact: true }).fill("2026-09-17");
await page.getByLabel("醒来时间时刻", { exact: true }).fill("03:10");
await page.getByRole("button", { name: "保存记录", exact: true }).click();
await page
  .getByRole("button", { name: "关闭记录编辑", exact: true })
  .waitFor({ state: "detached" });
assert.equal(
  await page.evaluate(
    () => JSON.parse(localStorage.getItem("little-days-v1")).entries.length,
  ),
  1,
);

await page.clock.setFixedTime(sleepClock);
await page.getByRole("button", { name: "睡了", exact: true }).click();
await page.getByText("正在睡觉", { exact: true }).waitFor();
await page.clock.setFixedTime(new Date(sleepClock.getTime() + 60_000));
await page.getByRole("button", { name: "醒了", exact: true }).click();
await page.getByRole("button", { name: "睡了", exact: true }).waitFor();
await page.getByText("已清醒 · 0分钟", { exact: true }).waitFor();
assert.equal(
  await page.getByTestId("today-last-sleep").innerText(),
  "1分钟 · 03:14–03:15",
);
const sleepRecords = await page.evaluate(
  () => JSON.parse(localStorage.getItem("little-days-v1")).entries,
);
assert.equal(sleepRecords.length, 2);
assert.equal(sleepRecords.filter((entry) => !entry.end).length, 0);
assert.ok(
  sleepRecords.some(
    (entry) => Date.parse(entry.end) - Date.parse(entry.start) === 60_000,
  ),
);

// A failed local save must undo the optimistic state instead of claiming sleep
// is durably running. Do not turn this into an unhandled page exception.
await page.evaluate(() => {
  window.sleepTestSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === "little-days-v1") throw new Error("sleep_test_storage_full");
    return window.sleepTestSetItem.call(this, key, value);
  };
});
await page.getByRole("button", { name: "睡了", exact: true }).click();
await page.getByText(/sleep_test_storage_full/).waitFor();
assert.equal(await page.getByText("正在睡觉", { exact: true }).count(), 0);
await page.evaluate(() => {
  Storage.prototype.setItem = window.sleepTestSetItem;
  delete window.sleepTestSetItem;
});
await page.getByRole("tab", { name: "我的", exact: true }).click();
await chooseEnglish();
await page.getByRole("tab", { name: "Today", exact: true }).click();
await page.getByText("Today's totals", { exact: true }).waitFor();
await page.getByRole("button", { name: "Sleep", exact: true }).click();
await page.getByText("Sleeping now", { exact: true }).waitFor();
await page.getByRole("button", { name: "Awake", exact: true }).click();
await page.getByText(/This sleep lasted less than 1 minute/).waitFor();
await assertNoUntranslatedChinese("live sleep feedback and today's totals");
await page
  .getByText(/This sleep lasted less than 1 minute/)
  .waitFor({ state: "hidden", timeout: 6500 });

// An overnight session keeps its full duration separate from time awake and
// today's midnight-clipped total. Previously these looked like a short sleep.
await page.clock.setFixedTime(new Date("2026-09-17T06:12:00+10:00"));
await page.evaluate(() => {
  localStorage.setItem(
    "little-days-v1",
    JSON.stringify({
      schemaVersion: 1,
      profile: { name: "Sleep test", birthDate: "", sex: "unspecified" },
      entries: [
        {
          id: "overnight-sleep-label",
          type: "sleep",
          start: "2026-09-16T22:05:00+10:00",
          end: "2026-09-17T06:05:00+10:00",
          note: "",
        },
      ],
    }),
  );
});
await page.reload();
await page.getByText("已清醒 · 7分钟", { exact: true }).waitFor();
assert.match(
  await page.getByTestId("today-last-sleep").innerText(),
  /^(?:上一觉 · )?8小时0分 · .*22:05–06:05$/,
);
await page.getByText("6.1", { exact: true }).waitFor();
await page.getByRole("tab", { name: "我的", exact: true }).click();
await chooseEnglish();
await page.getByRole("tab", { name: "Today", exact: true }).click();
await page.getByText("Awake · 7m", { exact: true }).waitFor();
assert.match(
  await page.getByTestId("today-last-sleep").innerText(),
  /^(?:Last sleep · )?8h 0m · .*22:05–06:05$/,
);
await assertNoUntranslatedChinese("overnight sleep and wake duration");
await page.getByRole("button", { name: "Sleep", exact: true }).click();
await page.getByText("Asleep for 0m", { exact: true }).waitFor();
assert.equal(await page.getByText(/^Awake ·/).count(), 0);
await page.getByRole("button", { name: "Awake", exact: true }).click();
await page.getByText("Awake · 7m", { exact: true }).waitFor();
await page.clock.setFixedTime(new Date("2026-09-17T07:12:00+10:00"));
await page.getByText("Awake · 1h 7m", { exact: true }).waitFor();

// Suggested feeding ends never go past now, including across midnight.
// Saving a feed started in the current minute must preserve valid seconds.
for (const [now, startDate, startTime, expectedEnd] of [
  ["2026-09-17T17:20:45+10:00", null, null, "17:20"],
  ["2026-09-17T17:20:45+10:00", "2026-09-17", "17:10", "17:20"],
  ["2026-09-17T23:55:45+10:00", "2026-09-17", "23:50", "23:55"],
]) {
  await page.clock.setFixedTime(new Date(now));
  const existingIds = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("little-days-v1")).entries.map(
      (entry) => entry.id,
    ),
  );
  await page
    .getByRole("button", { name: "+ Add", exact: true })
    .first()
    .click();
  if (startDate) {
    await page.getByLabel("Time date", { exact: true }).fill(startDate);
    await page.getByLabel("Time time", { exact: true }).fill(startTime);
  }
  await page
    .getByRole("button", { name: "+ Add end time (optional)", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("End time date", { exact: true }).inputValue(),
    "2026-09-17",
  );
  assert.equal(
    await page.getByLabel("End time time", { exact: true }).inputValue(),
    expectedEnd,
  );
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await page
    .getByLabel("Close editor", { exact: true })
    .waitFor({ state: "detached" });
  const savedFeed = await page.evaluate(
    (ids) =>
      JSON.parse(localStorage.getItem("little-days-v1")).entries.find(
        (entry) => entry.type === "feed" && !ids.includes(entry.id),
      ),
    existingIds,
  );
  assert.ok(savedFeed.end);
  assert.ok(Date.parse(savedFeed.end) <= Date.parse(now));
  assert.ok(Date.parse(savedFeed.end) >= Date.parse(savedFeed.start));
}
// Start-only feeding is a completed record unless Start timer is chosen.
const beforeStartOnly = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("little-days-v1")).entries.map(
    (entry) => entry.id,
  ),
);
await page.getByRole("button", { name: "+ Add", exact: true }).first().click();
await page.getByRole("button", { name: "Start timer", exact: true }).waitFor();
await page.getByRole("button", { name: "Save record", exact: true }).click();
await page
  .getByLabel("Close editor", { exact: true })
  .waitFor({ state: "detached" });
const startOnlyFeed = await page.evaluate(
  (ids) =>
    JSON.parse(localStorage.getItem("little-days-v1")).entries.find(
      (entry) => entry.type === "feed" && !ids.includes(entry.id),
    ),
  beforeStartOnly,
);
assert.equal(startOnlyFeed.end, undefined);
assert.equal(startOnlyFeed.feedRunning, undefined);

await page.getByRole("tab", { name: "Care", exact: true }).click();
await page.getByRole("button", { name: "Daily care", exact: true }).click();
const forehead = page.getByRole("button", { name: "Forehead", exact: true });
assert.equal(await forehead.locator("svg").count(), 1);
assert.equal((await forehead.innerText()).trim(), "Forehead");
for (const name of ["Armpit", "Ear", "Forehead", "Rectal", "Other"]) {
  const option = page.getByRole("button", { name, exact: true });
  assert.ok((await option.locator("svg").count()) >= 1);
  assert.equal((await option.innerText()).trim(), name);
}
await forehead.click();
await page.getByText("Selected: Forehead", { exact: true }).waitFor();
await forehead.locator("..").screenshot({
  path: path.join(screenshotDir, "temperature-method-icons.png"),
});
await page.getByRole("button", { name: "Supplements", exact: true }).click();
const supplementHelp = page.getByRole("button", {
  name: "Supplement guidance & references",
  exact: true,
});
assert.equal(await supplementHelp.getAttribute("aria-expanded"), "false");
assert.deepEqual(
  await page
    .getByRole("checkbox")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")),
    ),
  ["Vitamin D (VD)", "Probiotics", "Iron", "Multivitamin", "Other"],
);
assert.equal(await page.getByRole("checkbox", { checked: true }).count(), 0);
assert.equal(await page.getByRole("checkbox", { checked: false }).count(), 5);
await page
  .getByRole("checkbox", { name: "Vitamin D (VD)", exact: true })
  .click();
await page.getByRole("checkbox", { name: "Probiotics", exact: true }).click();
await page.getByRole("checkbox", { name: "Other", exact: true }).click();
await page
  .getByLabel("Other supplement name", { exact: true })
  .fill("Synthetic product");
await page.getByLabel("Care notes", { exact: true }).fill("As advised");
await page
  .getByRole("button", { name: "Save care record", exact: true })
  .click();
await page.getByText("Care record saved", { exact: true }).waitFor();
const savedSupplement = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("little-days-v1")).careRecords.find(
    (record) => record.kind === "supplement",
  ),
);
assert.deepEqual(savedSupplement.supplements, [
  "vitamin-d",
  "probiotics",
  "other",
]);
assert.equal(savedSupplement.otherSupplement, "Synthetic product");
await page
  .getByRole("button", { name: "Edit care record", exact: true })
  .click();
await page.getByText("Edit care record", { exact: true }).waitFor();
for (const name of ["Vitamin D (VD)", "Probiotics", "Other"])
  await page
    .getByRole("checkbox", { name, exact: true, checked: true })
    .waitFor();
assert.equal(
  await page.getByLabel("Other supplement name", { exact: true }).inputValue(),
  "Synthetic product",
);
await page.getByRole("checkbox", { name: "Other", exact: true }).click();
await page
  .getByRole("button", { name: "Save care record", exact: true })
  .click();
await page.getByText("Care record saved", { exact: true }).waitFor();
const updatedSupplement = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("little-days-v1")).careRecords.find(
    (record) => record.kind === "supplement",
  ),
);
assert.equal(updatedSupplement.id, savedSupplement.id);
assert.deepEqual(updatedSupplement.supplements, ["vitamin-d", "probiotics"]);
assert.equal(updatedSupplement.otherSupplement, undefined);
await supplementHelp.click();
await page
  .getByText(/Probiotics: effects depend on the strain and condition/)
  .waitFor();
await assertNoUntranslatedChinese("supplement guidance");
await page.reload();
await page.getByRole("tab", { name: "照护", exact: true }).click();
await page.getByRole("button", { name: "日常", exact: true }).click();
await page.getByRole("button", { name: "补充剂", exact: true }).click();
await page.getByText("维生素 D（VD） · 益生菌", { exact: true }).waitFor();
assert.equal(
  await page
    .getByRole("button", { name: "补充剂建议、注意事项与参考", exact: true })
    .getAttribute("aria-expanded"),
  "false",
);
// Today stays visible with three other record days; older days appear in
// seven-day increments, with the remainder still collapsed.
await page.clock.setFixedTime(new Date("2026-09-22T08:08:00+10:00"));
await page.evaluate(() => {
  const today = new Date();
  const entries = Array.from({ length: 15 }, (_, index) => {
    const start = new Date(today);
    start.setDate(start.getDate() - index);
    start.setHours(7, 0, 0, 0);
    return {
      id: `paged-feed-${index}`,
      type: "feed",
      feedKind: "formula",
      start: start.toISOString(),
      amount: 60,
      note: "",
    };
  });
  localStorage.setItem(
    "little-days-v1",
    JSON.stringify({
      schemaVersion: 1,
      profile: { name: "Paged records", birthDate: "", sex: "unspecified" },
      entries,
    }),
  );
  localStorage.setItem("little-days-v1-record-view", "bars");
});
await page.reload();
await page.getByRole("tab", { name: "记录", exact: true }).click();
await page.getByRole("button", { name: "全部", exact: true }).click();
assert.equal(
  await page.getByRole("button", { name: "展开当日明细", exact: true }).count(),
  3,
);
await page
  .getByRole("button", { name: "更多：显示前 7 天", exact: true })
  .click();
assert.equal(
  await page.getByRole("button", { name: "展开当日明细", exact: true }).count(),
  10,
);
await page
  .getByRole("button", { name: "更多：显示前 4 天", exact: true })
  .click();
assert.equal(
  await page.getByRole("button", { name: "展开当日明细", exact: true }).count(),
  14,
);
await page.getByRole("button", { name: "收起历史日期", exact: true }).click();
assert.equal(
  await page.getByRole("button", { name: "展开当日明细", exact: true }).count(),
  3,
);
// Every selectable language must keep the compact Today care summaries legible
// on the smallest supported phone width. Use only synthetic local records.
await page.clock.setFixedTime(new Date("2026-09-22T08:08:00+10:00"));
await page.evaluate(() => {
  localStorage.setItem(
    "little-days-v1",
    JSON.stringify({
      schemaVersion: 1,
      profile: { name: "Locale test", birthDate: "", sex: "unspecified" },
      entries: [
        {
          id: "locale-feed",
          type: "feed",
          feedKind: "formula",
          start: "2026-09-22T07:56:00+10:00",
          end: "2026-09-22T08:01:00+10:00",
          amount: 60,
          note: "",
        },
        {
          id: "locale-diaper",
          type: "diaper",
          diaperKind: "wet",
          start: "2026-09-22T07:19:00+10:00",
          note: "",
        },
        {
          id: "locale-sleep",
          type: "sleep",
          start: "2026-09-21T23:23:00+10:00",
          end: "2026-09-22T07:01:00+10:00",
          note: "",
        },
      ],
    }),
  );
});
await page.setViewportSize({ width: 320, height: 740 });
await page.reload();
for (const language of languageOptions.slice(1)) {
  await page.getByRole("tab").last().click();
  await page.getByTestId("language-picker-row").click();
  await page.getByRole("radio", { name: language, exact: true }).click();
  await page.getByRole("tab").first().click();
  const feed = await page.getByTestId("today-feed-recency").innerText();
  const diaper = await page.getByTestId("today-diaper-recency").innerText();
  const sleep = await page.getByTestId("today-last-sleep").innerText();
  assert.match(feed, /60 mL$/, language);
  assert.doesNotMatch(feed, /\d{2}:\d{2}/, language);
  assert.doesNotMatch(diaper, /\d{2}:\d{2}/, language);
  assert.match(sleep, /23:23–07:01$/, language);
  for (const [kind, selector] of [
    ["feed", "today-feed-recency"],
    ["diaper", "today-diaper-recency"],
    ["sleep", "today-last-sleep"],
  ]) {
    const box = await page.getByTestId(selector).boundingBox();
    assert.ok(
      box && box.height <= 30,
      `${language}: ${kind} wrapped: ${box?.height}`,
    );
  }
}
assert.deepEqual(errors, []);
console.log(
  "PASS: existing local flows, calendar/history, dark/narrow layout, bilingual family/account and live sleep/today summaries, preserved local history.",
);
await browser.close();
