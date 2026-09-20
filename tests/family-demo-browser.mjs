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
  // The sharing row is directly below the baby profile and opens in one tap.
  const profile = button(page, zh ? "展开宝宝档案" : "Expand baby profile");
  const sharing = button(page, zh ? "家庭共享" : "Family sharing");
  const profileBox = await profile.boundingBox();
  const sharingBox = await sharing.boundingBox();
  assert.ok(profileBox && sharingBox && sharingBox.y > profileBox.y);
  await expect(
    button(page, zh ? "展开家庭共享" : "Expand Family sharing"),
  ).toHaveCount(0);
  await button(page, zh ? "家庭共享" : "Family sharing").click();
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
  await expect(page.getByText("Signed in", { exact: true })).toBeVisible();
  await expect(button(page, "Accept invitation")).toHaveCount(2);
  await button(page, "Accept invitation").first().click();
  await expect(
    page.getByText(
      /The admin can remove you at any time without advance notice/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Joining will automatically decline all other pending invitations/,
    ),
  ).toBeVisible();
  await button(page, "Cancel").click();
  await expect(button(page, "Accept invitation")).toHaveCount(2);
  await button(page, "Accept invitation").first().click();
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
  await expect(
    page.getByLabel("Amount actually drunk (mL)", { exact: true }),
  ).toHaveValue("135");
  await button(page, "Save and share").click();
  await expect(page.getByText("135 mL", { exact: true })).toBeVisible();
  await expect(button(page, "Delete pilot account")).toBeDisabled();
  await button(page, "Show Family members (2)").click();
  await button(page, "Remove").click();
  await confirm(page, "Remove");
  await expect(button(page, "Remove")).toHaveCount(0);
  await expect(button(page, "Hide Family members (1)")).toBeVisible();
  await expect(button(page, "Show Invitations")).toHaveCount(0);
  await button(page, "Show Invite a caregiver").click();
  await expect(button(page, "Show Invitations")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(
    page.getByRole("button", { name: /Departure and removal history/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("sample.member@example.com", { exact: true }),
  ).toHaveCount(0);
  await button(page, "Show Invitations").click();
  await expect(
    page.getByText("sample.member@example.com", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Accepted · later removed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Unlinked membership history", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Sample Removed Member", { exact: true }),
  ).toHaveCount(1);
  await button(page, "Hide Invitations").click();
  await expect(button(page, "Hide Invite a caregiver")).toBeVisible();
  await expect(
    page.getByText("Accepted · later removed", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Recipient email", { exact: true })
    .fill("sample.member@example.com");
  await button(page, "Add invitation").click();
  await expect(
    page.getByText("Invitation saved; no notification sent", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Waiting for acceptance", { exact: true }),
  ).toHaveCount(0);
  await button(page, "Show Invitations").click();
  await expect(
    page.getByText("Accepted · later removed", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Waiting for acceptance", { exact: true }),
  ).toHaveCount(2);
  await expect(button(page, "Hide Family members (1)")).toBeVisible();
  await expect(button(page, "Hide Invitations")).toBeVisible();
  await expect(page.getByText("135 mL", { exact: true })).toBeVisible();
  await button(page, "Reset samples").click();
  await expect(button(page, "Edit")).toHaveCount(2);
  await expect(page.getByText("135 mL", { exact: true })).toHaveCount(0);

  await button(page, "Member").click();
  await expect(button(page, "Edit")).toHaveCount(1);
  await button(page, "Show Family members (2)").click();
  await expect(
    page.getByRole("button", { name: /Departure and removal history/ }),
  ).toHaveCount(0);
  await expect(button(page, "Show Invitations")).toHaveCount(0);
  await expect(button(page, "Hide Invitations")).toHaveCount(0);
  await expect(
    page.getByText("Unlinked membership history", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Sample Removed Member", { exact: true }),
  ).toHaveCount(0);
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
  await button(page, "Delete pilot account").click();
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
      name: "Create a family group",
      exact: true,
    }),
  ).toBeVisible();
  await button(page, "Invitations").click();
  await expect(button(page, "Accept invitation")).toHaveCount(2);
}

async function accountInvitationPlacementFlow(page, zh, dark, width) {
  const label = (en, chinese) => (zh ? chinese : en);
  await button(page, label("Invitations", "收到邀请")).click();
  const showAccount = label("Show My account", "展开我的账户");
  const hideAccount = label("Hide My account", "收起我的账户");
  const accept = label("Accept invitation", "接受邀请");
  const decline = label("Decline", "拒绝");
  const receivedTitle = label(
    "Received family invitations (2)",
    "收到的家庭邀请（2）",
  );
  const signedIn = page.getByText(label("Signed in", "已登录"), {
    exact: true,
  });
  const received = page.getByRole("heading", {
    name: receivedTitle,
    exact: true,
  });
  const accountHeader = button(page, showAccount);
  await expect(accountHeader).toHaveAttribute("aria-expanded", "false");
  await expect(received).toBeVisible();
  await expect(button(page, accept)).toHaveCount(2);
  await expect(button(page, decline)).toHaveCount(2);
  await expect(button(page, label("Sign out", "退出登录"))).toHaveCount(0);
  await expect(
    button(page, label("Delete pilot account", "删除试点账户")),
  ).toHaveCount(1);
  // Invitation actions are siblings below the disclosure header, never nested
  // interactive controls inside the account disclosure's button.
  await expect(
    accountHeader.getByRole("button", { name: accept, exact: true }),
  ).toHaveCount(0);
  const account = page
    .getByRole("button", {
      name: zh ? /^(?:展开|收起)我的账户$/ : /^(?:Show|Hide) My account$/,
    })
    .locator("..");
  await expect(
    account.getByRole("button", {
      name: label("Delete pilot account", "删除试点账户"),
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    account.getByRole("heading", { name: receivedTitle, exact: true }),
  ).toHaveCount(1);
  const statusBox = await signedIn.boundingBox();
  const receivedBox = await received.boundingBox();
  assert.ok(
    statusBox && receivedBox && receivedBox.y >= statusBox.y + statusBox.height,
  );
  await noOverflow(page, `Account invitations/${zh ? "zh" : "en"}/${width}`);
  await received.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(
      screenshots,
      `account-invitations-${zh ? "zh" : "en"}-${dark ? "dark" : "light"}-${width}.png`,
    ),
    animations: "disabled",
  });
  await accountHeader.click();
  await expect(button(page, hideAccount)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(received).toBeVisible();
  const deleteAccount = button(
    page,
    label("Delete pilot account", "删除试点账户"),
  );
  const signOut = button(page, label("Sign out", "退出登录"));
  await expect(deleteAccount).toBeVisible();
  await expect(
    account.getByRole("button", {
      name: label("Delete pilot account", "删除试点账户"),
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/permanent deletion processing|永久删除流程/),
  ).toHaveCount(0);
  const deleteBox = await deleteAccount.boundingBox();
  const signOutBox = await signOut.boundingBox();
  assert.ok(deleteBox && signOutBox && deleteBox.y > signOutBox.y);
  const deletionCard = deleteAccount.locator("../..");
  assert.ok(
    await page.evaluate(
      ({ account, deletion }) =>
        account.parentElement === deletion.parentElement,
      {
        account: await account.elementHandle(),
        deletion: await deletionCard.elementHandle(),
      },
    ),
    "Delete account and My account are separate sibling cards",
  );
  const createBox = await button(
    page,
    label("Show Create a family group", "展开创建家庭群组"),
  ).boundingBox();
  assert.ok(
    createBox && deleteBox.y > createBox.y + createBox.height,
    "Standalone deletion entry is below other management sections",
  );
  await deleteAccount.click();
  await confirmationPainted(page, zh);
  await expect(
    page.getByText(/permanent deletion processing|永久删除流程/),
  ).toBeVisible();
  await expect(
    button(page, label("Request account deletion", "申请删除账户")),
  ).toBeDisabled();
  await button(page, label("Cancel", "取消")).click();
  await expect(received).toBeVisible();
  await button(page, hideAccount).click();
  await expect(received).toBeVisible();
  await expect(deleteAccount).toBeVisible();
  await deleteAccount.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(
      screenshots,
      `standalone-deletion-${zh ? "zh" : "en"}-${dark ? "dark" : "light"}-${width}.png`,
    ),
    animations: "disabled",
  });
  await expect(button(page, accept)).toHaveCount(2);
  await button(page, decline).first().click();
  await confirmationPainted(page, zh);
  await button(page, label("Cancel", "取消")).click();
  await expect(button(page, accept)).toHaveCount(2);
  await button(page, decline).first().click();
  await confirm(page, decline, false, zh);
  await expect(button(page, accept)).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      name: label("Received family invitations (1)", "收到的家庭邀请（1）"),
      exact: true,
    }),
  ).toBeVisible();
  await button(page, label("Reset samples", "重置样例")).click();
  await expect(received).toBeVisible();
  await expect(button(page, accept)).toHaveCount(2);
}

async function receivedInvitationCreationFlow(page, zh) {
  const label = (en, chinese) => (zh ? chinese : en);
  await button(page, label("Invitations", "收到邀请")).click();
  const accept = label("Accept invitation", "接受邀请");
  await expect(button(page, accept)).toHaveCount(2);
  await button(
    page,
    label("Show Create a family group", "展开创建家庭群组"),
  ).click();
  await page
    .getByLabel(label("Family emails (up to 5)", "家人邮箱（最多 5 个）"), {
      exact: true,
    })
    .fill("new.family@example.com");
  await button(page, label("Review setup", "查看并确认")).click();
  const create = label(
    "Create family and decline invitations",
    "创建家庭并拒绝收到的邀请",
  );
  await expect(button(page, create)).toBeDisabled();
  await expect(
    page.getByText(
      label(
        "You have 2 pending family invitation(s).",
        "你有 2 条待处理的家庭邀请。",
      ),
      { exact: true },
    ),
  ).toBeVisible();
  await button(page, label("Cancel", "取消")).click();
  await expect(button(page, accept)).toHaveCount(2);
  await button(page, label("Review setup", "查看并确认")).click();
  await page.getByRole("checkbox").last().click();
  await button(page, create).click();
  await expect(button(page, accept)).toHaveCount(0);
  await expect(
    button(page, label("Show Create a family group", "展开创建家庭群组")),
  ).toHaveAttribute("aria-expanded", "false");
  const creationGuidance = page.getByText(
    zh
      ? /你已加入一个家庭群组并担任管理员/
      : /You already belong to a family group as its admin/,
  );
  await expect(creationGuidance).toHaveCount(0);
  await button(
    page,
    label("Show Create a family group", "展开创建家庭群组"),
  ).click();
  await expect(creationGuidance).toBeVisible();
  await expect(button(page, create)).toHaveCount(0);
  await button(
    page,
    label("Hide Create a family group", "收起创建家庭群组"),
  ).click();
  await expect(creationGuidance).toHaveCount(0);
}

async function nestedInvitationHistoryFlow(page, zh, dark, width) {
  const label = (en, chinese) => (zh ? chinese : en);
  const showForm = label("Show Invite a caregiver", "展开邀请照护者");
  const hideForm = label("Hide Invite a caregiver", "收起邀请照护者");
  const showHistory = label("Show Invitations", "展开邀请记录");
  const hideHistory = label("Hide Invitations", "收起邀请记录");
  const recipientLabel = label("Recipient email", "受邀邮箱");
  const draftEmail = "mia.huang.gyp@example.invalid";
  const screenshotSuffix = `${zh ? "zh" : "en"}-${dark ? "dark" : "light"}-${width}`;
  await button(page, label("Admin", "管理员")).click();
  await expect(button(page, showHistory)).toHaveCount(0);
  await expect(button(page, hideHistory)).toHaveCount(0);
  await button(page, showForm).click();
  const recipient = page.getByLabel(recipientLabel, { exact: true });
  await recipient.fill(draftEmail);
  await expect(button(page, showHistory)).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(
    button(page, showHistory).getByText(label("Expand", "展开"), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("sample.guest@example.com", { exact: true }),
  ).toHaveCount(0);

  // Find the smallest rendered ancestor that contains both the outer header
  // and its input. It must also contain history, but not the next admin section.
  // This verifies one visual group without relying on generated RN Web classes.
  const form = button(page, hideForm).locator(
    `xpath=ancestor::*[.//*[@aria-label='${recipientLabel}']][1]`,
  );
  await expect(
    form.getByRole("button", { name: showHistory, exact: true }),
  ).toHaveCount(1);
  await expect(
    form.getByRole("button", {
      name: label("Show Admin role", "展开管理员权限"),
      exact: true,
    }),
  ).toHaveCount(0);
  const formBox = await form.boundingBox();
  const historyBox = await button(page, showHistory).boundingBox();
  const addBox = await button(
    page,
    label("Add invitation", "添加邀请"),
  ).boundingBox();
  assert.ok(formBox && historyBox && addBox);
  assert.ok(historyBox.y >= addBox.y + addBox.height);
  assert.ok(historyBox.x >= formBox.x && historyBox.y >= formBox.y);
  assert.ok(historyBox.x + historyBox.width <= formBox.x + formBox.width + 1);
  assert.ok(historyBox.y + historyBox.height <= formBox.y + formBox.height + 1);
  await noOverflow(
    page,
    `Nested invitation history collapsed/${screenshotSuffix}`,
  );
  await form.screenshot({
    path: path.join(
      screenshots,
      `invitation-history-collapsed-${screenshotSuffix}.png`,
    ),
    animations: "disabled",
  });

  await button(page, showHistory).click();
  await expect(button(page, hideHistory)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(
    button(page, hideHistory).getByText(label("Collapse", "收起"), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    form.getByText("sample.guest@example.com", { exact: true }),
  ).toBeVisible();
  await expect(recipient).toHaveValue(draftEmail);
  await expect(button(page, label("Revoke", "撤销"))).toHaveCount(1);
  await noOverflow(
    page,
    `Nested invitation history expanded/${screenshotSuffix}`,
  );
  await form.screenshot({
    path: path.join(
      screenshots,
      `invitation-history-expanded-${screenshotSuffix}.png`,
    ),
    animations: "disabled",
  });
  await button(page, hideHistory).click();
  await expect(recipient).toHaveValue(draftEmail);
  await expect(button(page, label("Revoke", "撤销"))).toHaveCount(0);
  await button(page, hideForm).click();
  await expect(button(page, showHistory)).toHaveCount(0);
  await expect(button(page, hideHistory)).toHaveCount(0);
  await expect(recipient).toHaveCount(0);
  await button(page, showForm).click();
  await expect(button(page, showHistory)).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(recipient).toHaveValue(draftEmail);
  await button(page, hideForm).click();
}

async function firstInvitationFlow(page, zh, width) {
  const label = (en, chinese) => (zh ? chinese : en);
  const setupTitle = label("Create a family group", "创建家庭群组");
  const reviewTitle = label(
    "Review the family’s starting data",
    "确认家庭初始资料",
  );
  const emailsLabel = label("Family emails (up to 5)", "家人邮箱（最多 5 个）");
  const reviewLabel = label("Review setup", "查看并确认");
  const createLabel = label("Create family and invite", "创建家庭并邀请");
  const startingTitle = label("Family starting records", "家庭初始记录");
  await expect(
    page.getByRole("heading", { name: setupTitle, exact: true }),
  ).toBeVisible();
  const showSetup = label(`Show ${setupTitle}`, `展开${setupTitle}`);
  const hideSetup = label(`Hide ${setupTitle}`, `收起${setupTitle}`);
  await expect(page.getByLabel(emailsLabel, { exact: true })).toHaveCount(0);
  await expect(button(page, showSetup)).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await button(page, showSetup).click();
  await expect(button(page, hideSetup)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
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
  await button(page, hideSetup).click();
  await expect(page.getByLabel(emailsLabel, { exact: true })).toHaveCount(0);
  await button(page, showSetup).click();
  await expect(page.getByLabel(emailsLabel, { exact: true })).toHaveValue(
    "invalid-address",
  );
  // Exercise a reduced usable viewport, as when a mobile keyboard occupies
  // the lower screen. Native iOS keyboard insets still need device acceptance.
  const fullViewport = page.viewportSize();
  await page.setViewportSize({ width, height: 420 });
  await page.getByLabel(emailsLabel, { exact: true }).focus();
  await button(page, reviewLabel).scrollIntoViewIfNeeded();
  await expect(button(page, reviewLabel)).toBeInViewport();
  await button(page, reviewLabel).click();
  await expect(page.getByRole("alert")).toContainText(
    label(
      "Enter 1–5 valid, different family email addresses.",
      "请填写 1–5 个有效且不同的家人邮箱。",
    ),
  );
  await expect(
    page.getByRole("heading", { name: reviewTitle, exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize(fullViewport);
  await page
    .getByLabel(emailsLabel, { exact: true })
    .fill(
      Array.from({ length: 6 }, (_, i) => `family${i}@example.com`).join("\n"),
    );
  await button(page, reviewLabel).click();
  await expect(page.getByRole("alert")).toContainText(
    label(
      "Enter 1–5 valid, different family email addresses.",
      "请填写 1–5 个有效且不同的家人邮箱。",
    ),
  );
  await expect(
    page.getByRole("heading", { name: reviewTitle, exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel(emailsLabel, { exact: true })
    .fill(
      " FAMILY.ONE@example.com, family.two@example.com\nfamily.one@example.com\nfamily.three@example.com\nfamily.four@example.com\nfamily.five@example.com ",
    );
  await button(page, reviewLabel).click();
  await expect(
    page.getByRole("heading", { name: reviewTitle, exact: true }),
  ).toBeVisible();
  await expect(button(page, createLabel)).toBeDisabled();
  await expect(button(page, createLabel)).toBeInViewport();
  await expect(button(page, label("Cancel", "取消"))).toBeInViewport();
  await expect(
    page.getByText(label("Total records: 7", "记录总数：7"), { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(label("Invitees: 5/5", "受邀人数：5/5"), { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText(
        label(
          "Creating your own family group will automatically decline all pending invitations you have received, including any arriving before creation completes. If creation fails, they stay pending. To join another family later, leave or close your group and receive a new invitation.",
          "创建自己的家庭群组后，系统将自动拒绝你收到的所有待处理邀请，包括创建完成前新收到的邀请。创建失败则保留邀请。以后如需加入其他家庭，请先退出或解散自己的群组，并获取新的邀请。",
        ),
        { exact: true },
      )
      .last(),
  ).toBeVisible();
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
  await expect(button(page, createLabel)).toBeInViewport();
  await expect(button(page, label("Cancel", "取消"))).toBeInViewport();
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
  await expect(button(page, label("Revoke", "撤销"))).toHaveCount(0);
  await expect(
    button(page, label("Show Invitations", "展开邀请记录")),
  ).toHaveAttribute("aria-expanded", "false");
  await button(page, label("Show Invitations", "展开邀请记录")).click();
  await expect(button(page, label("Revoke", "撤销"))).toHaveCount(5);
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
  await expect(page.getByLabel(emailsLabel, { exact: true })).toHaveCount(0);
  await button(page, showSetup).click();
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
    await accountInvitationPlacementFlow(page, zh, dark, width);
    await receivedInvitationCreationFlow(page, zh);
    if (locale === "en" && width === 390) await englishFlows(page);
    await nestedInvitationHistoryFlow(page, zh, dark, width);
    for (const scenario of scenarios[locale]) {
      await button(page, scenario).click();
      if (
        ["Signed out", "Account deletion", "未登录", "删除账户"].includes(
          scenario,
        )
      ) {
        await expect(
          button(page, zh ? "删除试点账户" : "Delete pilot account"),
        ).toHaveCount(0);
      }
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
      await expect(
        page.getByText(/加入成功时，系统将自动拒绝你收到的其他待处理邀请/),
      ).toBeVisible();
      await button(page, "取消").click();
      await expect(button(page, "接受邀请")).toHaveCount(2);
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
    "PASS: 9 family UI scenarios, collapsed-account incoming invitations and cancellation/confirmed decline, standalone bottom-level deletion card with consent, first-invitation seed review/cancel/consent with multiple emails, nested collapsed invitation history with preserved drafts, invitation consent, roles, editing, removal, transfer, closure, deletion and reset; English/Chinese, light/dark at 390/320px; all original record types preserved, no family persistence or API/auth traffic.",
  );
} finally {
  await browser.close();
}
