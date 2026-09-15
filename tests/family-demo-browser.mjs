import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

// Serve the exported UI-preview bundle without a server or external network.
const origin = "http://family-ui-preview.test";
const output = path.resolve("dist-ui-demo");
await fs.access(path.join(output, "index.html"));
const screenshots = path.join(output, "screenshots");
await fs.mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const scenarios = {
  en: [
    "First invitation",
    "Signed out",
    "Invitations",
    "Admin",
    "Member",
    "Admin transfer",
    "Close family",
    "Removed",
    "Account deletion",
  ],
  zh: [
    "首次邀请",
    "未登录",
    "收到邀请",
    "管理员",
    "家庭成员",
    "接受管理权",
    "关闭家庭",
    "已被移除",
    "删除账户",
  ],
};
const fixture = {
  schemaVersion: 1,
  profile: {
    name: "Offline Fixture",
    birthDate: "2026-07-01",
    sex: "unspecified",
  },
  entries: [
    {
      id: "private-local-feed",
      type: "feed",
      start: "2026-09-01T01:00:00.000Z",
      end: "2026-09-01T01:20:00.000Z",
      amount: 85,
      feedKind: "formula",
      note: "Original offline record must remain untouched",
    },
    {
      id: "private-local-diaper",
      type: "diaper",
      start: "2026-09-01T02:00:00.000Z",
      diaperKind: "mixed",
      note: "Original offline nappy",
    },
    {
      id: "private-local-sleep",
      type: "sleep",
      start: "2026-09-01T03:00:00.000Z",
      end: "2026-09-01T04:00:00.000Z",
      note: "Original offline sleep",
    },
    {
      id: "private-local-growth",
      type: "growth",
      start: "2026-09-01T04:00:00.000Z",
      weight: 4.25,
      length: 54.5,
      head: 36.1,
      note: "Original offline growth",
    },
    {
      id: "private-local-milestone",
      type: "milestone",
      start: "2026-09-01T04:00:00.000Z",
      title: "Private first smile",
      note: "Original offline milestone",
    },
  ],
  careRecords: [
    {
      id: "private-local-care",
      kind: "temperature",
      time: "2026-09-01T02:00:00.000Z",
      temperature: 36.8,
      method: "armpit",
      note: "Original offline care",
    },
  ],
};
const button = (page, name) => page.getByRole("button", { name, exact: true });

async function openDemo(page, zh) {
  await page
    .getByRole("tab", { name: zh ? "我的" : "More", exact: true })
    .click();
  const disclosure = button(
    page,
    zh ? "展开家庭共享" : "Expand Family sharing",
  );
  if (await disclosure.isVisible()) await disclosure.click();
  await button(
    page,
    zh ? "界面预览（无需登录）" : "Preview screens — no login",
  ).click();
  await expect(
    page.getByRole("heading", {
      name: zh ? "界面预览" : "UI preview",
      exact: true,
    }),
  ).toBeVisible();
}

async function noOverflow(page, label) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    `${label}: page overflows horizontally`,
  );
}

async function confirmationPainted(page, zh = false) {
  const warning = page.getByText(
    zh
      ? "模拟操作：只改变当前样例画面，不会操作真实账户或记录。"
      : "Simulated action: changes only this sample screen, never real accounts or records.",
    { exact: true },
  );
  await expect(warning).toBeVisible();
  // RN Web fades its modal portal separately from the inner visible elements.
  await expect
    .poll(() =>
      warning.evaluate((element) => {
        for (let current = element; current; current = current.parentElement) {
          if (Number(getComputedStyle(current).opacity) < 0.99) return false;
        }
        return true;
      }),
    )
    .toBe(true);
}

async function confirm(page, name, consent = false, zh = false) {
  await confirmationPainted(page, zh);
  const action = button(page, name).last();
  if (consent) {
    await expect(action).toBeDisabled();
    await page.getByRole("checkbox").last().click();
    await expect(action).toBeEnabled();
  }
  await action.click();
}

async function englishFlows(page) {
  await button(page, "Invitations").click();
  await expect(button(page, "Accept invitation")).toHaveCount(2);
  await button(page, "Accept invitation").first().click();
  await expect(
    page.getByText(
      /The admin can remove you at any time without advance notice/,
    ),
  ).toBeVisible();
  await confirmationPainted(page);
  await page.screenshot({
    path: path.join(screenshots, "join-consent-en-390.png"),
    animations: "disabled",
  });
  await confirm(page, "Accept invitation", true);
  await expect(
    page.getByRole("heading", { name: "Test bottle feeds", exact: true }),
  ).toBeVisible();
  await expect(button(page, "Edit")).toHaveCount(1);
  await expect(button(page, "Show Invite a caregiver")).toHaveCount(0);

  await button(page, "Admin").click();
  await expect(button(page, "Edit")).toHaveCount(2);
  await button(page, "Edit").last().click();
  await page
    .getByLabel("Amount actually drunk (mL)", { exact: true })
    .fill("135");
  await button(page, "Save and share").click();
  await expect(page.getByText("135 mL", { exact: true })).toBeVisible();
  await button(page, "Show Pilot account").click();
  await expect(button(page, "Request account deletion")).toBeDisabled();
  await button(page, "Show Family members (4)").click();
  await button(page, "Remove").click();
  await confirm(page, "Remove");
  await expect(button(page, "Remove")).toHaveCount(0);
  await expect(page.getByText("135 mL", { exact: true })).toBeVisible();
  await button(page, "Reset samples").click();
  await expect(button(page, "Edit")).toHaveCount(2);
  await expect(page.getByText("135 mL", { exact: true })).toHaveCount(0);

  await button(page, "Member").click();
  await expect(button(page, "Edit")).toHaveCount(1);
  await button(page, "Show Family members (4)").click();
  await expect(button(page, "Remove")).toHaveCount(0);
  await button(page, "Leave test family").click();
  await confirm(page, "Leave test family");
  await expect(
    page.getByRole("heading", { name: "Test bottle feeds", exact: true }),
  ).toHaveCount(0);

  await button(page, "Admin transfer").click();
  await expect(button(page, "Edit")).toHaveCount(1);
  await button(page, "Accept admin role").click();
  await confirm(page, "Accept admin role");
  await expect(button(page, "Edit")).toHaveCount(2);
  await expect(button(page, "Show Invite a caregiver")).toHaveCount(1);

  await button(page, "Close family").click();
  await button(page, "Show Admin role").click();
  await button(page, "Close test family").click();
  await confirm(page, "Close test family", true);
  await expect(
    page.getByRole("heading", { name: "Test bottle feeds", exact: true }),
  ).toHaveCount(0);

  await button(page, "Removed").click();
  await expect(
    page.getByRole("heading", { name: "Test bottle feeds", exact: true }),
  ).toHaveCount(0);
  await expect(button(page, "Edit")).toHaveCount(0);

  await button(page, "Member").click();
  await button(page, "Show Pilot account").click();
  await button(page, "Request account deletion").click();
  await confirm(page, "Request account deletion", true);
  await expect(
    page.getByRole("heading", {
      name: "Account deletion is processing",
      exact: true,
    }),
  ).toBeVisible();
  await button(page, "Check deletion status").click();
  await expect(
    page.getByRole("heading", {
      name: "Waiting for identity-account deletion",
      exact: true,
    }),
  ).toBeVisible();
  await button(page, "Check deletion status").click();
  await expect(
    page.getByRole("heading", {
      name: "Account deletion completed",
      exact: true,
    }),
  ).toBeVisible();
  await button(page, "Done; clear status receipt").click();
  await expect(button(page, "Sign in to the pilot")).toBeVisible();
  await button(page, "Sign in to the pilot").click();
  await expect(button(page, "Accept invitation")).toHaveCount(2);
  await button(page, "Decline").first().click();
  await confirm(page, "Decline");
  await expect(button(page, "Accept invitation")).toHaveCount(1);
  await button(page, "Back").click();
  await openDemo(page, false);
  await expect(
    page.getByRole("heading", {
      name: "Start a family with your records",
      exact: true,
    }),
  ).toBeVisible();
  await button(page, "Invitations").click();
  await expect(button(page, "Accept invitation")).toHaveCount(2);
}

async function firstInvitationFlow(page, zh, width) {
  const label = (en, chinese) => (zh ? chinese : en);
  const setupTitle = label(
    "Start a family with your records",
    "从现有记录建立家庭",
  );
  const reviewTitle = label(
    "Review the family’s starting data",
    "确认家庭初始资料",
  );
  const emailsLabel = label("Family emails (up to 3)", "家人邮箱（最多 3 个）");
  const reviewLabel = label("Review setup", "查看并确认");
  const createLabel = label("Create family and invite", "创建家庭并邀请");
  const startingTitle = label("Family starting records", "家庭初始记录");
  await expect(
    page.getByRole("heading", { name: setupTitle, exact: true }),
  ).toBeVisible();
  await expect(button(page, reviewLabel)).toBeDisabled();
  await expect(page.getByText("Offline Fixture", { exact: true })).toHaveCount(
    0,
  );
  if (!zh && width === 390) {
    await page
      .getByRole("heading", { name: setupTitle, exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(screenshots, "first-invitation-en-390.png"),
      animations: "disabled",
    });
  }
  await page.getByLabel(emailsLabel, { exact: true }).fill("invalid-address");
  await button(page, reviewLabel).click();
  await expect(page.getByRole("alert")).toContainText(
    label(
      "Enter 1–3 valid, different family email addresses.",
      "请填写 1–3 个有效且不同的家人邮箱。",
    ),
  );
  await expect(
    page.getByRole("heading", { name: reviewTitle, exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel(emailsLabel, { exact: true })
    .fill(
      " FAMILY.ONE@example.com, family.two@example.com\nfamily.one@example.com ",
    );
  await button(page, reviewLabel).click();
  await expect(
    page.getByRole("heading", { name: reviewTitle, exact: true }),
  ).toBeVisible();
  await expect(button(page, createLabel)).toBeDisabled();
  await expect(
    page.getByText("family.one@example.com", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText("family.two@example.com", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page
      .getByText(
        label(
          "Only fictional sample data is used below. Creation and invitations are simulated for this preview session.",
          "下面仅使用虚构的样例资料。创建和邀请都是本次预览中的模拟操作。",
        ),
        { exact: true },
      )
      .last(),
  ).toBeVisible();
  await noOverflow(
    page,
    `First invitation review/${zh ? "zh" : "en"}/${width}`,
  );
  if (!zh && width === 390) {
    await expect
      .poll(() =>
        page
          .getByRole("heading", { name: reviewTitle, exact: true })
          .evaluate((element) => {
            for (
              let current = element;
              current;
              current = current.parentElement
            ) {
              if (Number(getComputedStyle(current).opacity) < 0.99)
                return false;
            }
            return true;
          }),
      )
      .toBe(true);
    await page.screenshot({
      path: path.join(screenshots, "first-invitation-review-en-390.png"),
      animations: "disabled",
    });
  }
  await button(page, label("Cancel", "取消")).click();
  await expect(
    page.getByRole("heading", { name: startingTitle, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: setupTitle, exact: true }),
  ).toBeVisible();
  await button(page, reviewLabel).click();
  await expect(button(page, createLabel)).toBeDisabled();
  await page.getByRole("checkbox").last().click();
  await expect(button(page, createLabel)).toBeEnabled();
  await button(page, createLabel).click();
  await expect(
    page.getByRole("heading", { name: startingTitle, exact: true }),
  ).toBeVisible();
  await expect(button(page, label("Edit", "编辑"))).toHaveCount(1);
  await expect(page.getByText("100 mL", { exact: true })).toBeVisible();
  await expect(page.getByText("85 mL", { exact: true })).toHaveCount(0);
  for (const name of [
    label("Feeds", "喂养"),
    label("Nappies", "尿布"),
    label("Sleep", "睡眠"),
    label("Growth", "成长"),
    label("Milestones", "里程碑"),
    label("Daily care", "日常照护"),
  ]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await button(
    page,
    label("Show Invite a caregiver", "展开邀请照护者"),
  ).click();
  await expect(button(page, label("Revoke", "撤销"))).toHaveCount(2);
  await expect(
    page.getByText("family.one@example.com", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("family.two@example.com", { exact: true }),
  ).toBeVisible();
  await expect(
    button(page, label("Show Family members (1)", "展开家庭成员（1）")),
  ).toBeVisible();
  await button(page, label("Reset samples", "重置样例")).click();
  await expect(
    page.getByRole("heading", { name: setupTitle, exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel(emailsLabel, { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: startingTitle, exact: true }),
  ).toHaveCount(0);
}

try {
  for (const [locale, dark, width] of [
    ["en", false, 390],
    ["en", true, 320],
    ["zh", true, 390],
    ["zh", false, 320],
  ]) {
    const zh = locale === "zh";
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      timezoneId: "Australia/Sydney",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [],
      unexpectedRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.addInitScript(
      ({ fixture, locale, dark }) => {
        localStorage.setItem("little-days-v1", JSON.stringify(fixture));
        localStorage.setItem("little-days-v1-language", locale);
        localStorage.setItem("little-days-v1-dark", String(dark));
        window.__familyPersistence = [];
        for (const method of ["setItem", "removeItem", "clear"]) {
          const original = Storage.prototype[method];
          Storage.prototype[method] = function (...args) {
            if (method === "clear" || /family|demo/i.test(String(args[0])))
              window.__familyPersistence.push([method, args[0]]);
            return original.apply(this, args);
          };
        }
        const open = indexedDB.open.bind(indexedDB);
        indexedDB.open = (...args) => {
          if (/family|demo/i.test(String(args[0])))
            window.__familyPersistence.push(["indexedDB", args[0]]);
          return open(...args);
        };
      },
      { fixture, locale, dark },
    );
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (
        url.origin !== origin ||
        request.method() !== "GET" ||
        /\/(v1|auth)\//.test(url.pathname)
      ) {
        unexpectedRequests.push(
          `${request.method()} ${url.origin}${url.pathname}`,
        );
        return route.abort();
      }
      const local = path.resolve(
        output,
        "." +
          (url.pathname === "/"
            ? "/index.html"
            : decodeURIComponent(url.pathname)),
      );
      if (!local.startsWith(output + path.sep))
        return route.fulfill({ status: 403, body: "forbidden" });
      try {
        await route.fulfill({
          body: await fs.readFile(local),
          contentType: local.endsWith(".js")
            ? "application/javascript"
            : local.endsWith(".html")
              ? "text/html"
              : local.endsWith(".css")
                ? "text/css"
                : "application/octet-stream",
        });
      } catch {
        await route.fulfill({ status: 404, body: "not found" });
      }
    });
    await page.goto(origin);
    await page
      .getByRole("tab", { name: zh ? "我的" : "More", exact: true })
      .waitFor();
    const originalData = await page.evaluate(() =>
      localStorage.getItem("little-days-v1"),
    );
    await openDemo(page, zh);
    await expect(
      page.getByText(zh ? /^仅供界面预览/ : /^UI preview only/),
    ).toBeVisible();
    await firstInvitationFlow(page, zh, width);
    if (locale === "en" && width === 390) await englishFlows(page);
    for (const scenario of scenarios[locale]) {
      await button(page, scenario).click();
      await noOverflow(
        page,
        `${locale}/${dark ? "dark" : "light"}/${width}/${scenario}`,
      );
      await expect(
        button(page, zh ? "重置样例" : "Reset samples"),
      ).toBeVisible();
    }
    await button(page, zh ? "管理员" : "Admin").click();
    await page.screenshot({
      path: path.join(
        screenshots,
        `admin-${locale}-${dark ? "dark" : "light"}-${width}.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
    if (zh) {
      await button(page, "收到邀请").click();
      await button(page, "接受邀请").first().click();
      await noOverflow(page, `Chinese consent/${width}`);
      await confirm(page, "接受邀请", true, true);
      await expect(button(page, "编辑")).toHaveCount(1);
    }
    assert.equal(
      await page.evaluate(() => localStorage.getItem("little-days-v1")),
      originalData,
      "UI demo changed the original offline history",
    );
    assert.deepEqual(
      await page.evaluate(() => window.__familyPersistence),
      [],
      "UI demo accessed persistent family storage",
    );
    assert.deepEqual(
      unexpectedRequests,
      [],
      "UI demo attempted non-asset/API/auth requests",
    );
    assert.deepEqual(errors, [], "UI preview raised browser errors");
    await context.close();
  }
  console.log(
    "PASS: 9 family UI scenarios, first-invitation seed review/cancel/consent with multiple emails, invitation consent, roles, editing, removal, transfer, closure, deletion and reset; English/Chinese, light/dark at 390/320px; all original record types preserved, no family persistence or API/auth traffic.",
  );
} finally {
  await browser.close();
}
