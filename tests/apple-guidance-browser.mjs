import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

// Browser acceptance uses synthetic local-only data and blocks every external
// origin. It tests web input focus/layout, not an iOS keyboard, native Dynamic
// Type, VoiceOver, Large Content Viewer or physical iPad rendering.
const output = path.resolve("work/apple-guidance-review");
await fs.mkdir(output, { recursive: true });
const scenarios = [
  { width: 320, language: "zh", dark: false, contrast: "more" },
  { width: 390, language: "en", dark: false, contrast: "no-preference" },
  { width: 390, language: "zh", dark: true, contrast: "no-preference" },
  { width: 768, language: "en", dark: true, contrast: "more" },
];
const copy = {
  en: {
    tabs: ["Today", "Care", "Records", "Growth", "More"],
    titles: ["Baby's little days", "Care", "Records", "Growth", "More"],
    add: "+ Add",
    close: "Close editor",
    amount: "Amount fed",
    notes: "Notes",
    save: /^(Start|Save record)$/,
    local: "Saved on this device · no internet needed",
    daily: "Daily care",
    temperature: "Temp",
    temperatureField: "Temperature · °C",
    careHelp: "Recording help & references",
    careIntro:
      "Record care you actually provided, not daily tasks. Temperature and care history are kept; drafts are only stored when you tap Save.",
    urgentCare: /Under 3 months with a temperature/,
    rawReading:
      "Record the reading without adding or subtracting for the measurement site.",
    nailSafety:
      "An adult should use baby-suitable tools and pause if baby wriggles.",
    nails: "Nails",
    careDate: "Care date",
    careTime: "Care time",
    careNotes: "Care notes",
    careSave: "Save care record",
    supplements: "Supplements",
    supplementHelp: "Supplement guidance & references",
    supplementOther: "Other",
    supplementName: "Other supplement name",
    expandProfile: "Expand baby profile",
    expandLanguage: "Expand Language",
    collapseLanguage: "Collapse Language",
    expandTheme: "Expand Theme",
    collapseTheme: "Collapse Theme",
    selectedTheme: { light: "Light", dark: "Dark" },
  },
  zh: {
    tabs: ["今天", "照护", "记录", "成长", "我的"],
    titles: ["宝宝的小日子", "照护", "记录", "成长", "我的"],
    add: "＋记录",
    close: "关闭记录编辑",
    amount: "实际喝奶量",
    notes: "备注",
    save: /^(开始|保存记录)$/,
    local: "仅保存在这台设备 · 无需联网",
    daily: "日常",
    temperature: "体温",
    temperatureField: "体温 · °C",
    careHelp: "记录说明与参考",
    careIntro:
      "记录实际做过的照护，不是每日任务。测温、洗澡等记录会保留历史，填写后点保存才生效。",
    urgentCare: /未满 3 个月且体温/,
    rawReading: "记录原始读数，不按测量部位自行加减。",
    nailSafety: "由成人使用婴儿适用工具，宝宝挣动时暂停。",
    nails: "指甲",
    careDate: "照护日期",
    careTime: "照护时间",
    careNotes: "照护备注",
    careSave: "保存照护记录",
    supplements: "补充剂",
    supplementHelp: "补充剂建议、注意事项与参考",
    supplementOther: "其他",
    supplementName: "其他补充剂名称",
    expandProfile: "展开宝宝档案",
    expandLanguage: "展开语言",
    collapseLanguage: "收起语言",
    expandTheme: "展开主题",
    collapseTheme: "收起主题",
    selectedTheme: { light: "浅色", dark: "深色" },
  },
};

const browser = await chromium.launch({ headless: true });
let blockedExternalRequests = 0;
try {
  for (const scenario of scenarios) {
    const { width, language, dark, contrast } = scenario;
    const words = copy[language];
    const name = `${width}-${language}-${dark ? "dark" : "light"}-${contrast}`;
    const context = await browser.newContext({
      viewport: { width, height: width === 768 ? 1024 : 844 },
      colorScheme: dark ? "dark" : "light",
      contrast,
      reducedMotion: "reduce",
      timezoneId: "Australia/Sydney",
    });
    await context.addInitScript(
      ({ language, dark }) => {
        localStorage.setItem("little-days-v1-language", language);
        localStorage.setItem("little-days-v1-dark", String(dark));
        const birth = new Date();
        birth.setDate(birth.getDate() - 70);
        const birthDate = `${birth.getFullYear()}-${String(birth.getMonth() + 1).padStart(2, "0")}-${String(birth.getDate()).padStart(2, "0")}`;
        localStorage.setItem(
          "little-days-v1",
          JSON.stringify({
            schemaVersion: 1,
            profile: {
              name: language === "en" ? "Baby" : "宝宝",
              birthDate,
              sex: "unspecified",
            },
            entries: [],
          }),
        );
      },
      { language, dark },
    );
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
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
    const tab = (index) =>
      page.getByRole("tab", { name: words.tabs[index], exact: true });
    async function select(index) {
      await tab(index).click();
      await page
        .getByRole("heading", { name: words.titles[index], exact: true })
        .waitFor();
      assert.equal(
        await tab(index).getAttribute("aria-selected"),
        "true",
        name,
      );
      assert.equal(
        await page.getByRole("tab", { selected: true }).count(),
        1,
        name,
      );
    }
    async function bounded(locator, contextLabel, minimumHeight = 0) {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      assert.ok(
        box && box.width > 0 && box.x >= -1 && box.x + box.width <= width + 1,
        `${name} ${contextLabel}: ${JSON.stringify(box)}`,
      );
      assert.ok(
        box.height >= minimumHeight,
        `${name} ${contextLabel} height ${box.height}`,
      );
    }
    async function noPageOverflow() {
      const size = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      assert.ok(
        size.document <= size.viewport + 1 && size.body <= size.viewport + 1,
        `${name}: ${JSON.stringify(size)}`,
      );
    }
    await page.goto("http://little-days.test");
    await page
      .getByRole("heading", { name: words.titles[0], exact: true })
      .waitFor();
    assert.equal(await page.getByRole("tab").count(), 5);
    for (let index = 0; index < 5; index++) {
      await bounded(tab(index), `tab ${words.tabs[index]}`, 44);
      await select(index);
      await noPageOverflow();
    }

    // Settings sections are discoverable controls and report expansion state.
    await bounded(
      page.getByRole("button", { name: words.expandProfile, exact: true }),
      "profile disclosure",
      44,
    );
    const languageDisclosure = page.getByRole("button", {
      name: words.expandLanguage,
      exact: true,
    });
    await languageDisclosure.click();
    assert.equal(
      await page
        .getByRole("button", { name: words.collapseLanguage, exact: true })
        .getAttribute("aria-expanded"),
      "true",
    );
    await page
      .getByRole("button", { name: words.collapseLanguage, exact: true })
      .click();
    await page
      .getByRole("button", { name: words.expandTheme, exact: true })
      .click();
    const theme = page.getByRole("radio", {
      name: words.selectedTheme[dark ? "dark" : "light"],
      exact: true,
    });
    assert.equal(await theme.getAttribute("aria-checked"), "true");
    await bounded(theme, "selected appearance", 44);
    await page
      .getByRole("button", { name: words.collapseTheme, exact: true })
      .click();

    // Arrow keys, Home and End preserve roving focus on the selected tab.
    await select(0);
    await tab(0).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await tab(1).getAttribute("aria-selected"), "true");
    assert.equal(
      await tab(1).evaluate((node) => document.activeElement === node),
      true,
    );
    await page.keyboard.press("End");
    assert.equal(await tab(4).getAttribute("aria-selected"), "true");
    await page.keyboard.press("Home");
    assert.equal(await tab(0).getAttribute("aria-selected"), "true");
    await page.screenshot({ path: path.join(output, `today-${name}.png`) });

    // Focus and edit real web fields without writing a record. Native virtual
    // keyboard presentation remains a physical-device acceptance step.
    await page
      .getByRole("button", { name: words.add, exact: true })
      .first()
      .click();
    const close = page.getByRole("button", { name: words.close, exact: true });
    await close.waitFor();
    const amount = page.getByLabel(words.amount, { exact: true });
    await amount.fill("120");
    await bounded(amount, "feeding amount", 44);
    const expected = dark
      ? contrast === "more"
        ? { background: "rgb(16, 17, 19)", text: "rgb(255, 255, 255)" }
        : { background: "rgb(36, 36, 38)", text: "rgb(242, 242, 247)" }
      : contrast === "more"
        ? { background: "rgb(255, 255, 255)", text: "rgb(0, 0, 0)" }
        : { background: "rgb(255, 255, 255)", text: "rgb(28, 28, 30)" };
    await page.waitForFunction(
      ({ label, expected }) => {
        const input = document.querySelector(`[aria-label="${label}"]`);
        const style = input && getComputedStyle(input);
        return (
          style?.backgroundColor === expected.background &&
          style.color === expected.text
        );
      },
      { label: words.amount, expected },
    );
    const notes = page.getByLabel(words.notes, { exact: true });
    await notes.fill(
      language === "en" ? "Local preview layout check" : "本机预览布局检查",
    );
    assert.equal(
      await notes.evaluate((node) => document.activeElement === node),
      true,
    );
    await bounded(notes, "feeding notes", 44);
    const save = page.getByRole("button", { name: words.save, exact: true });
    await bounded(save, "feeding action", 44);
    await page.getByText(words.local, { exact: true }).waitFor();
    await noPageOverflow();
    await page.screenshot({ path: path.join(output, `editor-${name}.png`) });
    await close.click();

    await select(1);
    await page.getByRole("button", { name: words.daily, exact: true }).click();
    const temperature = page.getByLabel(words.temperatureField, {
      exact: true,
    });
    const help = page.getByRole("button", {
      name: words.careHelp,
      exact: true,
    });
    assert.equal(await help.getAttribute("aria-expanded"), "false");
    assert.equal(
      await page.getByText(words.careIntro, { exact: true }).count(),
      0,
    );
    const temperatureBox = await temperature.boundingBox();
    const safetyBox = await page.getByText(words.urgentCare).boundingBox();
    assert.equal(
      await page.getByText(words.rawReading, { exact: true }).isVisible(),
      true,
    );
    assert.ok(
      temperatureBox &&
        temperatureBox.y >= 0 &&
        temperatureBox.y + temperatureBox.height < 550,
      `${name}: the recording input must precede explanatory help and remain above the fold`,
    );
    assert.ok(
      safetyBox && safetyBox.y >= temperatureBox.y + temperatureBox.height,
      "urgent safety guidance must remain outside collapsed help, next to the measured input",
    );
    await page.screenshot({
      path: path.join(output, `temperature-${name}.png`),
    });
    await temperature.fill("37.2");
    await page
      .getByLabel(words.careNotes, { exact: true })
      .fill("Unsaved care draft");
    await bounded(help, "care help disclosure", 44);
    await help.click();
    await page.getByText(words.careIntro, { exact: true }).waitFor();
    assert.equal(await help.getAttribute("aria-expanded"), "true");
    assert.equal(await temperature.inputValue(), "37.2");
    assert.equal(
      await page.getByLabel(words.careNotes, { exact: true }).inputValue(),
      "Unsaved care draft",
    );
    await help.click();
    assert.equal(await help.getAttribute("aria-expanded"), "false");
    assert.equal(
      await page.getByText(words.careIntro, { exact: true }).count(),
      0,
    );
    await page.getByRole("button", { name: words.nails, exact: true }).click();
    assert.equal(await help.getAttribute("aria-expanded"), "false");
    assert.equal(
      await page.getByText(words.nailSafety, { exact: true }).isVisible(),
      true,
    );
    const careDate = page.getByLabel(words.careDate, { exact: true });
    const careTime = page.getByLabel(words.careTime, { exact: true });
    const careNotes = page.getByLabel(words.careNotes, { exact: true });
    await careTime.fill("09:00");
    await careNotes.fill(
      language === "en" ? "Care form preview" : "照护表单预览",
    );
    assert.equal(
      await careNotes.evaluate((node) => document.activeElement === node),
      true,
    );
    for (const [field, label] of [
      [careDate, "care date"],
      [careTime, "care time"],
      [careNotes, "care notes"],
    ]) {
      await bounded(field, label, 44);
    }
    await bounded(
      page.getByRole("button", { name: words.careSave, exact: true }),
      "care save",
      44,
    );
    await noPageOverflow();
    await page.screenshot({ path: path.join(output, `care-${name}.png`) });
    await page
      .getByRole("button", { name: words.supplements, exact: true })
      .click();
    const supplementHelp = page.getByRole("button", {
      name: words.supplementHelp,
      exact: true,
    });
    assert.equal(await supplementHelp.getAttribute("aria-expanded"), "false");
    const checkboxes = page.getByRole("checkbox");
    assert.equal(await checkboxes.count(), 5);
    for (let index = 0; index < 5; index++)
      await bounded(checkboxes.nth(index), `supplement checkbox ${index}`, 44);
    await checkboxes.nth(0).click();
    await checkboxes.nth(1).click();
    await page
      .getByRole("checkbox", { name: words.supplementOther, exact: true })
      .click();
    const custom = page.getByLabel(words.supplementName, { exact: true });
    await custom.fill(language === "en" ? "Synthetic product" : "示例产品");
    await bounded(custom, "custom supplement name", 44);
    await bounded(
      page.getByRole("button", { name: words.careSave, exact: true }),
      "supplement save",
      44,
    );
    await noPageOverflow();
    await checkboxes.nth(0).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(output, `supplements-${name}.png`),
    });
    await bounded(supplementHelp, "supplement help", 44);
    await supplementHelp.click();
    await noPageOverflow();
    await page.screenshot({
      path: path.join(output, `supplement-help-${name}.png`),
    });
    assert.deepEqual(pageErrors, [], name);
    console.log(
      `PASS ${name}: five-tab labels/selection, keyboard navigation, settings disclosures, focused editor/care forms, ${contrast} colors, bounded controls.`,
    );
    await context.close();
  }
  console.log(
    `PASS: 24 isolated browser captures; no external requests were allowed (${blockedExternalRequests} blocked). Native accessibility and keyboard acceptance remains separate.`,
  );
} finally {
  await browser.close();
}
