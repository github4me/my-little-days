import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Run the real screen against a deterministic React Native/controller boundary.
// Disclosures are expanded by default to inspect their contents. These checks cover access
// controls and confirmation wiring, not React scheduling, layout or a real device.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(
  overrides = {},
  locale = "en",
  demo = false,
  section = "all",
  expandDisclosures = true,
) {
  let active = "",
    slot = 0,
    nodes = [];
  const values = new Map(),
    refs = new Map(),
    effects = new Map(),
    calls = [];
  const palette = {
    bg: "#F4F9FD",
    card: "#FFFFFF",
    text: "#29475E",
    muted: "#60798D",
    line: "#DCE8F1",
    primary: "#34759D",
    soft: "#E3F1FB",
  };
  const react = {
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...props,
          ...(children.length
            ? {
                children: children.length === 1 ? children[0] : children,
              }
            : {}),
        },
      };
    },
    useContext: () => palette,
    useEffect(effect, dependencies) {
      const key = `${active}:effect:${slot++}`;
      const previous = effects.get(key);
      if (
        !previous ||
        dependencies.some((value, index) => !Object.is(value, previous[index]))
      ) {
        effects.set(key, dependencies);
        effect();
      }
    },
    useRef(value) {
      const key = `${active}:ref:${slot++}`;
      if (!refs.has(key)) refs.set(key, { current: value });
      return refs.get(key);
    },
    useState(value) {
      const key = `${active}:${slot++}`;
      if (!values.has(key))
        values.set(
          key,
          expandDisclosures && active.endsWith("Disclosure")
            ? true
            : typeof value === "function"
              ? value()
              : value,
        );
      return [
        values.get(key),
        (next) =>
          values.set(
            key,
            typeof next === "function" ? next(values.get(key)) : next,
          ),
      ];
    },
  };
  const ui = {
    Theme: palette,
    ...Object.fromEntries(
      ["T", "Card", "Button"].map((name) => [
        name,
        (props) => react.createElement(name, props),
      ]),
    ),
  };
  const native = {
    Keyboard: { dismiss: () => calls.push({ name: "dismissKeyboard" }) },
    ...Object.fromEntries(
      [
        "ActivityIndicator",
        "Image",
        "KeyboardAvoidingView",
        "Modal",
        "Pressable",
        "ScrollView",
        "TextInput",
        "View",
      ].map((name) => [name, name]),
    ),
    Platform: { OS: "ios" },
    StyleSheet: { create: (value) => value },
  };
  const controller = {
    configured: true,
    webUnsupported: false,
    authStatus: overrides.user === null ? "signed_out" : "authenticated",
    user: {
      id: "user",
      displayName: "Test member",
      email: "test@example.invalid",
    },
    snapshot: null,
    inbox: [],
    busy: false,
    syncing: false,
    error: null,
    notice: null,
    dismissedFeedback: null,
    dismissFeedback(key) {
      controller.dismissedFeedback = key;
    },
    transitionPending: false,
    activationPending: false,
    accountDeletion: null,
    deletionStatus: null,
    draft: null,
    feeds: [],
    pending: [],
    conflicts: [],
    hasPrivateWork: false,
    ...Object.fromEntries(
      [
        "refresh",
        "signOut",
        "signIn",
        "acceptInvitation",
        "declineInvitation",
        "createFamily",
        "createInvitation",
        "deleteAccount",
        "checkDeletionStatus",
        "closeFamily",
        "acceptOwnership",
        "cancelOwnership",
        "nominateOwner",
        "updateProfile",
        "beginFeed",
        "deleteFeed",
        "dismissDeletionStatus",
      ].map((name) => [
        name,
        async (...args) => {
          calls.push({ name, args });
        },
      ]),
    ),
    ...overrides,
  };
  let messages;
  function load(relative) {
    const code = ts.transpileModule(
      fs.readFileSync(path.join(root, relative), "utf8"),
      {
        compilerOptions: {
          jsx: ts.JsxEmit.React,
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
      },
    ).outputText;
    const result = { exports: {} };
    vm.runInNewContext(code, {
      module: result,
      exports: result.exports,
      Error,
      Date,
      Intl,
      Number,
      String,
      Map,
      Set,
      require(name) {
        if (name === "react") return react;
        if (name === "react-native") return native;
        if (name === "react-native-safe-area-context")
          return { SafeAreaView: "SafeAreaView" };
        if (name === "@react-native-community/datetimepicker")
          return () => null;
        if (name === "../i18n") return { useI18n: () => ({ locale }) };
        if (name === "../ui") return ui;
        if (name === "./messages") return messages;
        if (name === "./invitationCapacity")
          return load("src/family/invitationCapacity.ts");
        if (name === "./extras") return load("src/family/extras.ts");
        if (name === "../reminderSettings")
          return load("src/reminderSettings.ts");
        if (name === "./OwnerSetupCard")
          return load("src/family/OwnerSetupCard.tsx");
        if (name === "./FamilyScreenView")
          return load("src/family/FamilyScreenView.tsx");
        if (name === "./FamilySyncStatus")
          return { FamilySyncDetails: () => null };
        if (name === "./useFamilyPilot")
          return { useFamilyPilot: () => controller };
        throw new Error(`Unexpected screen dependency: ${name}`);
      },
    });
    return result.exports;
  }
  messages = load("src/family/messages.ts");
  const Screen = load("src/family/FamilyScreenView.tsx").default;
  function visit(element, position = "0") {
    if (element == null || typeof element === "boolean") return;
    if (Array.isArray(element))
      return element.forEach((child, index) =>
        visit(child, `${position}.${index}`),
      );
    if (typeof element !== "object")
      return nodes.push({ text: String(element) });
    if (typeof element.type === "function") {
      const previous = [active, slot];
      active = position + element.type.name;
      slot = 0;
      visit(element.type(element.props), `${position}.component`);
      [active, slot] = previous;
      return;
    }
    if (element.type === "Modal" && !element.props.visible) return;
    nodes.push(element);
    visit(element.props.children, `${position}.children`);
  }
  return {
    calls,
    controller,
    unmount() {
      values.clear();
      refs.clear();
      effects.clear();
      nodes = [];
    },
    render() {
      nodes = [];
      visit(
        react.createElement(Screen, {
          onBack() {},
          pilot: controller,
          demo,
          section,
        }),
      );
      return nodes;
    },
    renderOwnerSetup(props) {
      nodes = [];
      visit(
        react.createElement(
          load("src/family/OwnerSetupCard.tsx").default,
          props,
        ),
      );
      return nodes;
    },
    buttons(label) {
      return nodes.filter(
        (node) => node.type === "Button" && node.props.label === label,
      );
    },
    text() {
      return nodes
        .filter((node) => node.text)
        .map((node) => node.text)
        .join("\n");
    },
    modalText() {
      const index = nodes.findIndex((node) => node.type === "Modal");
      return index < 0
        ? ""
        : nodes
            .slice(index)
            .filter((node) => node.text)
            .map((node) => node.text)
            .join("\n");
    },
    nodes: () => nodes,
  };
}

test("owner review dismisses the email keyboard before preparation without losing multiline input", async () => {
  const world = fixture();
  const emails = "one@example.test\ntwo@example.test";
  let preparedEmails;
  const props = {
    mode: "full",
    profile: { name: "Baby", sex: "unspecified" },
    summary: {
      counts: {
        feed: 0,
        diaper: 0,
        sleep: 0,
        growth: 0,
        milestone: 0,
        care: 0,
        total: 0,
      },
      runningCount: 0,
    },
    onPrepare: async (value) => {
      world.calls.push({ name: "prepare" });
      preparedEmails = value;
      throw new Error("owner_invalid_email");
    },
    onSave: async () => {
      throw new Error("Review must not save records");
    },
  };
  world.renderOwnerSetup(props);
  world
    .nodes()
    .find(
      (node) => node.props?.accessibilityLabel === "Show Create a family group",
    )
    .props.onPress();
  world.renderOwnerSetup(props);
  world
    .nodes()
    .find((node) => node.type === "TextInput")
    .props.onChangeText(emails);
  world.renderOwnerSetup(props);
  world.buttons("Review setup")[0].props.onPress();
  await tick();
  assert.deepEqual(
    world.calls.map((call) => call.name),
    ["dismissKeyboard", "prepare"],
  );
  assert.equal(preparedEmails, emails);
  world.renderOwnerSetup(props);
  assert.equal(
    world.nodes().find((node) => node.type === "TextInput").props.value,
    emails,
  );
  assert.match(
    world.text(),
    /Enter 1–5 valid, different family email addresses/,
  );
});

const feed = (id, user) => ({
  id,
  recordedBy: user,
  lastEditedBy: user,
  amount: 100,
  start: "2026-09-01T01:00:00Z",
  end: "2026-09-01T01:20:00Z",
  note: "",
  version: "1",
});
const snapshot = (role = "caregiver") => ({
  family: {
    id: "family",
    babyName: "Fictional",
    role,
    membershipId: "grant",
    babyBirthDate: null,
    profileVersion: "1",
  },
  members: [
    {
      id: "user",
      membershipId: "grant",
      displayName: "Test member",
      role,
      status: "active",
      endedAt: null,
    },
  ],
  invitations: [],
  ownershipTransfer: null,
  feeds: [],
  historyId: "history",
  revision: "1",
});

const snapshotWithMemberHistory = (role) => {
  const family = snapshot(role);
  family.members.push(
    {
      id: "removed-user",
      membershipId: "removed-grant",
      displayName: "Removed caregiver",
      email: "removed@example.invalid",
      role: "caregiver",
      status: "removed",
      endedAt: "2026-09-16T10:30:00Z",
    },
    {
      id: "former-user",
      membershipId: "former-grant",
      displayName: "Former caregiver",
      email: "former@example.invalid",
      role: "caregiver",
      status: "left",
      endedAt: "2026-09-15T10:30:00Z",
    },
  );
  return family;
};

test("removal reduces member count and keeps unlinked history inside collapsed invitations", () => {
  for (const locale of ["en", "zh-CN"]) {
    const family = snapshotWithMemberHistory("owner");
    const departing = {
      id: "departing-user",
      membershipId: "departing-grant",
      displayName: "Departing caregiver",
      email: "departing@example.invalid",
      role: "caregiver",
      status: "active",
      endedAt: null,
    };
    family.members.push(departing);
    const view = fixture({ snapshot: family }, locale, false, "family", false);
    const findToggle = (en, zh) =>
      view
        .nodes()
        .find(
          (node) =>
            node.props?.accessibilityLabel === (locale === "en" ? en : zh),
        );
    view.render();
    assert.ok(findToggle("Show Family members (2)", "展开家庭成员（2）"));
    departing.status = "removed";
    departing.endedAt = "2026-09-16T11:00:00Z";
    view.render();
    findToggle("Show Family members (1)", "展开家庭成员（1）").props.onPress();
    view.render();
    assert.doesNotMatch(
      view.text(),
      /Departing caregiver|Removed caregiver|Former caregiver/,
    );
    assert.doesNotMatch(
      view.text(),
      /Departure and removal history|退出与移除历史/,
    );
    const history = findToggle("Show Invitations", "展开邀请记录");
    assert.equal(history?.props.accessibilityState.expanded, false);
    history.props.onPress();
    view.render();
    assert.match(view.text(), /Departing caregiver/);
    assert.match(view.text(), /removed@example.invalid/);
    assert.match(view.text(), /former@example.invalid/);
    assert.match(
      view.text(),
      locale === "en" ? /Unlinked membership history/ : /未关联邀请的成员历史/,
    );
    assert.doesNotMatch(view.text(), /No invitations sent yet|还没有发出邀请/);
    assert.match(view.text(), locale === "en" ? /Access ended/ : /结束访问/);
    assert.match(
      view.text(),
      locale === "en" ? /invite them again/i : /再次邀请/,
    );
    assert.equal(view.buttons(locale === "en" ? "Remove" : "移除").length, 0);
    assert.equal(view.calls.length, 0);
    family.members.push({
      ...departing,
      membershipId: "rejoined-grant",
      status: "active",
      endedAt: null,
    });
    view.render();
    assert.ok(findToggle("Hide Family members (2)", "收起家庭成员（2）"));
    assert.ok(findToggle("Hide Invitations", "收起邀请记录"));
    assert.equal(view.buttons(locale === "en" ? "Remove" : "移除").length, 1);
  }
});

test("ordinary members never see former-member history even if cached snapshot contains it", () => {
  for (const locale of ["en", "zh-CN"]) {
    const data = snapshotWithMemberHistory("caregiver");
    data.invitations = [
      {
        id: "private-invite",
        email: "invited@example.invalid",
        status: "pending",
        expiresAt: "2027-01-01T00:00:00Z",
      },
    ];
    const view = fixture({ snapshot: data }, locale);
    view.render();
    assert.match(
      view.text(),
      locale === "en" ? /Family members \(1\)/ : /家庭成员（1）/,
    );
    assert.doesNotMatch(
      view.text(),
      /Removed caregiver|Former caregiver|removed@example.invalid|former@example.invalid|invited@example.invalid/,
    );
    assert.doesNotMatch(
      view.text(),
      /Departure and removal history|退出与移除历史|Invitations|邀请记录/,
    );
  }
});

test("embedded account includes account controls and omits family management and page chrome", () => {
  for (const role of ["owner", "caregiver"]) {
    const screen = fixture(
      { snapshot: snapshot(role) },
      "en",
      false,
      "account",
    );
    screen.render();
    assert.match(screen.text(), /My account/);
    assert.match(screen.text(), /test@example.invalid/);
    assert.equal(screen.buttons("Sign out").length, 1);
    assert.equal(screen.buttons("Request account deletion").length, 1);
    assert.equal(screen.buttons("Back").length, 0);
    assert.equal(screen.buttons("Add invitation").length, 0);
    assert.equal(screen.buttons("Leave family").length, 0);
    assert.doesNotMatch(
      screen.text(),
      /Family sharing|Creating a family shares|Test baby profile|Family members|Create a family group|All family records are connected/,
    );
  }
});

test("account stays identifiable when signed out or family services are unavailable", () => {
  for (const locale of ["en", "zh-CN"]) {
    for (const overrides of [
      { user: null },
      { user: null, configured: false },
      { user: null, webUnsupported: true },
    ]) {
      const screen = fixture(overrides, locale, false, "account");
      screen.render();
      assert.match(screen.text(), locale === "en" ? /My account/ : /我的账户/);
      assert.equal(screen.buttons(locale === "en" ? "Back" : "返回").length, 0);
      if (overrides.configured !== false && !overrides.webUnsupported) {
        assert.equal(
          screen.buttons(locale === "en" ? "Login" : "登录").length,
          1,
        );
      }
    }
  }
});

test("family mode omits the normal account and duplicate legacy baby profile", () => {
  for (const role of ["owner", "caregiver"]) {
    const screen = fixture({ snapshot: snapshot(role) }, "en", false, "family");
    screen.render();
    assert.doesNotMatch(screen.text(), /My account|Test baby profile/);
    assert.equal(screen.buttons("Sign out").length, 0);
    assert.equal(screen.buttons("Request account deletion").length, 0);
    assert.equal(
      screen.buttons("Add invitation").length,
      role === "owner" ? 1 : 0,
    );
    assert.equal(
      screen.buttons("Leave family").length,
      role === "caregiver" ? 1 : 0,
    );
  }
});

test("family mode retains reauthentication and unconfirmed-transition recovery", () => {
  const expired = fixture(
    { authStatus: "reauth_required", snapshot: snapshot() },
    "en",
    false,
    "family",
  );
  expired.render();
  assert.match(expired.text(), /Session expired/);
  assert.equal(expired.buttons("Sign in again").length, 1);
  assert.equal(expired.buttons("Sign out").length, 1);
  assert.equal(
    expired.buttons("Request account deletion")[0].props.disabled,
    true,
  );
  for (const section of ["account", "family"]) {
    const recovery = fixture({ transitionPending: true }, "en", false, section);
    recovery.render();
    assert.match(recovery.text(), /Confirming a family change/);
    assert.equal(recovery.buttons("Sign out")[0].props.disabled, false);
    assert(recovery.buttons("Refresh").length > 0);
  }
});

test("family mode can refresh incoming invitations without the account panel", async () => {
  const screen = fixture({}, "en", false, "family");
  screen.render();
  assert.doesNotMatch(screen.text(), /My account/);
  assert.equal(screen.buttons("Refresh").length, 1);
  screen.buttons("Refresh")[0].props.onPress();
  await tick();
  assert.deepEqual(
    screen.calls.map((call) => call.name),
    ["refresh"],
  );
});

test("family recovery retains sign out when shared history is not ready", () => {
  const screen = fixture(
    { sharedMode: true, ready: false, error: "invalid_response" },
    "en",
    false,
    "family",
  );
  screen.render();
  assert.match(screen.text(), /My account/);
  assert.equal(screen.buttons("Sign out").length, 1);
  assert.equal(screen.buttons("Sign out")[0].props.disabled, false);
  assert(screen.buttons("Refresh").length > 0);
});

test("embedded account deletion still requires consent and submits through its confirmation", async () => {
  const screen = fixture({}, "en", false, "account");
  screen.render();
  screen.buttons("Request account deletion")[0].props.onPress();
  screen.render();
  assert.equal(
    screen.buttons("Request account deletion").at(-1).props.disabled,
    true,
  );
  screen
    .nodes()
    .findLast((node) => node.props?.accessibilityRole === "checkbox")
    .props.onPress();
  screen.render();
  screen.buttons("Request account deletion").at(-1).props.onPress();
  await tick();
  assert.deepEqual(
    screen.calls.map((call) => call.name),
    ["deleteAccount"],
  );
});

test("account and family modes retain deletion receipts after sign out", () => {
  for (const section of ["account", "family"]) {
    const screen = fixture(
      {
        user: null,
        deletionStatus: {
          deletionId: "deletion",
          status: "awaiting_identity_deletion",
          requestedAt: "2026-09-01T01:00:00Z",
        },
      },
      "en",
      false,
      section,
    );
    screen.render();
    assert.equal(screen.buttons("Check deletion status").length, 1);
    assert.equal(screen.buttons("Login").length, 0);
    assert.match(screen.text(), /not yet confirmed deleted/);
  }
});

test("real account and family views hide routine local-save notices while demo retains them", () => {
  for (const section of ["all", "account", "family"]) {
    const screen = fixture({ notice: "saved_locally" }, "en", false, section);
    screen.render();
    assert.doesNotMatch(screen.text(), /Saved on this device|waiting to sync/i);
  }
  const demo = fixture({ notice: "saved_locally" }, "en", true);
  demo.render();
  assert.match(demo.text(), /Saved on this device/i);
});

test("dismissing real feedback hides only presentation and controller updates can show new issues", () => {
  const screen = fixture(
    { error: "network_unavailable", transitionPending: true },
    "en",
    false,
    "account",
  );
  const dismiss = () => {
    screen
      .nodes()
      .find((node) => node.props?.accessibilityLabel === "Dismiss message")
      .props.onPress();
    screen.render();
  };
  const alertCount = () =>
    screen.nodes().filter((node) => node.props?.accessibilityRole === "alert")
      .length;
  screen.render();
  assert.equal(alertCount(), 1);
  dismiss();
  assert.equal(alertCount(), 0);
  screen.unmount();
  screen.render();
  assert.equal(alertCount(), 0);
  assert.equal(screen.controller.error, "network_unavailable");
  assert.equal(screen.controller.authStatus, "authenticated");
  assert.equal(screen.controller.transitionPending, true);
  assert.equal(screen.calls.length, 0);

  screen.controller.error = "local_save_failed";
  screen.controller.dismissedFeedback = null;
  screen.render();
  assert.equal(alertCount(), 1);
  dismiss();
  screen.controller.error = null;
  screen.controller.dismissedFeedback = null;
  screen.render();
  screen.controller.error = "local_save_failed";
  screen.render();
  assert.equal(alertCount(), 1);
  dismiss();
  screen.controller.user = { ...screen.controller.user, id: "another-user" };
  screen.controller.dismissedFeedback = null;
  screen.render();
  assert.equal(alertCount(), 1);
  dismiss();
  screen.controller.snapshot = snapshot();
  screen.controller.dismissedFeedback = null;
  screen.render();
  assert.equal(alertCount(), 1);
});

test("live account sign-out describes local cleanup and retained shared data in both languages", () => {
  for (const locale of ["zh-CN", "en"]) {
    const screen = fixture(
      { user: null, notice: "signed_out" },
      locale,
      false,
      "account",
    );
    screen.render();
    assert.doesNotMatch(screen.text(), /试点|测试|pilot|test account/i);
    assert.match(
      screen.text(),
      locale === "zh-CN"
        ? /此设备上的家庭数据和登录信息已清除/
        : /Family data and sign-in details have been cleared from this device/,
    );
    assert.match(
      screen.text(),
      locale === "zh-CN"
        ? /已共享记录仍保留在家庭中/
        : /Shared records remain with the family/,
    );
    assert.equal(screen.calls.length, 0);
  }
});

test("live account errors never describe production families as a fictional pilot", () => {
  for (const locale of ["zh-CN", "en"]) {
    for (const error of [
      "network_unavailable",
      "pilot_not_admitted",
      "membership_revoked",
      "already_in_family",
      "history_changed",
      "sign_in_failed",
      "session_changed",
      "local_data_invalid",
      "sign_out_first",
      "sign_out_failed",
      "family_unavailable",
      "queue_full",
      "deletion_receipt_unavailable",
    ]) {
      const screen = fixture({ error }, locale, false, "account");
      screen.render();
      assert(
        screen
          .nodes()
          .some((node) => node.props?.accessibilityRole === "alert"),
        `${locale}: ${error} must be visible`,
      );
      assert.doesNotMatch(
        screen.text(),
        /试点|测试家庭|测试记录|pilot|test family|test feed|fictional/i,
        `${locale}: ${error}`,
      );
      if (error === "sign_out_failed")
        assert.doesNotMatch(
          screen.text(),
          /原有离线记录不受影响|existing offline records are unaffected/i,
        );
      assert.equal(screen.calls.length, 0);
    }
  }
});

test("dismissed sign-out notice stays hidden after leaving and remounting the account page", () => {
  const screen = fixture(
    { user: null, notice: "signed_out" },
    "zh-CN",
    false,
    "account",
  );
  screen.render();
  assert.match(screen.text(), /已退出/);
  screen
    .nodes()
    .find((node) => node.props?.accessibilityLabel === "关闭提示")
    .props.onPress();
  screen.render();
  assert.doesNotMatch(screen.text(), /已退出/);
  screen.unmount();
  screen.render();
  assert.doesNotMatch(screen.text(), /已退出/);
  assert.equal(screen.controller.notice, "signed_out");
  assert.equal(screen.controller.authStatus, "signed_out");
  assert.equal(screen.calls.length, 0);
});

test("real notices can be dismissed without clearing the controller and demo feedback stays unchanged", () => {
  const screen = fixture(
    { notice: "sign_in_cancelled" },
    "en",
    false,
    "account",
  );
  screen.render();
  assert.match(screen.text(), /This sign-in attempt was cancelled/);
  screen
    .nodes()
    .find((node) => node.props?.accessibilityLabel === "Dismiss message")
    .props.onPress();
  screen.render();
  assert.doesNotMatch(screen.text(), /This sign-in attempt was cancelled/);
  assert.equal(screen.controller.notice, "sign_in_cancelled");
  assert.equal(screen.calls.length, 0);
  const demo = fixture(
    { error: "network_unavailable", notice: "sign_in_cancelled" },
    "en",
    true,
  );
  demo.render();
  assert(
    demo.nodes().some((node) => node.props?.accessibilityRole === "alert"),
  );
  assert(
    !demo
      .nodes()
      .some((node) => node.props?.accessibilityLabel === "Dismiss message"),
  );
  demo.controller.error = null;
  demo.controller.notice = "change_not_shared";
  demo.render();
  assert.match(demo.text(), /It is kept under Private changes to review/);
  assert.doesNotMatch(demo.text(), /Sharing issues and preserved changes/);
});

test("invitation form counts members and pending places while allowing pending-email replacement", async () => {
  const family = snapshot("owner");
  family.members.push(
    ...[1, 2].map((i) => ({
      id: `member-${i}`,
      membershipId: `grant-${i}`,
      displayName: `Member ${i}`,
      email: `member${i}@example.test`,
      role: "caregiver",
      status: "active",
      endedAt: null,
    })),
  );
  family.invitations = [1, 2, 3].map((i) => ({
    id: `invite-${i}`,
    email: `guest${i}@example.test`,
    status: "pending",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  }));
  const view = fixture({ snapshot: family });
  view.render();
  const typeEmail = (email) => {
    view
      .nodes()
      .find(
        (node) =>
          node.type === "TextInput" &&
          node.props.accessibilityLabel === "Recipient email",
      )
      .props.onChangeText(email);
    view.render();
  };
  typeEmail("another@example.test");
  assert.equal(view.buttons("Add invitation")[0].props.disabled, true);
  await view.buttons("Add invitation")[0].props.onPress();
  await tick();
  assert.equal(
    view.calls.filter((call) => call.name === "createInvitation").length,
    0,
  );
  assert.match(view.text(), /5\/5/);
  typeEmail("GUEST1@example.test");
  assert.equal(view.buttons("Add invitation")[0].props.disabled, false);
  family.invitations[0].expiresAt = new Date(Date.now() - 1000).toISOString();
  typeEmail("another@example.test");
  assert.equal(view.buttons("Add invitation")[0].props.disabled, false);
  assert.match(view.text(), /4\/5/);
});

test("expired cached accounts remain expired after cancellation and cannot perform account actions", () => {
  for (const locale of ["en", "zh-CN"]) {
    const view = fixture(
      { authStatus: "reauth_required", error: "sign_in_cancelled" },
      locale,
    );
    view.render();
    assert.match(
      view.text(),
      locale === "en" ? /Session expired/ : /登录已过期/,
    );
    assert.match(
      view.text(),
      locale === "en" ? /cached account details/ : /缓存的账户资料/,
    );
    assert.equal(
      view.buttons(locale === "en" ? "Sign in again" : "重新登录").length,
      1,
    );
    assert.equal(
      view.buttons(
        locale === "en" ? "Request account deletion" : "申请删除账户",
      )[0].props.disabled,
      true,
    );
    assert.equal(view.buttons(locale === "en" ? "Refresh" : "刷新").length, 0);
    assert.doesNotMatch(
      view.text(),
      locale === "en" ? /Sign-in was cancelled/ : /登录已取消/,
    );
  }
});

test("unverified cached identity is not presented as signed in or allowed to delete", () => {
  const view = fixture({
    authStatus: "unverified",
    error: "network_unavailable",
  });
  view.render();
  assert.match(view.text(), /Not verified/);
  assert.doesNotMatch(view.text(), /Signed in/);
  assert.equal(
    view.buttons("Request account deletion")[0].props.disabled,
    true,
  );
  assert.equal(view.buttons("Refresh")[0].props.disabled, false);
});

test("verified account ignores obsolete login errors while preserving unrelated failures", () => {
  for (const error of [
    "sign_in_cancelled",
    "sign_in_required",
    "unauthorized",
  ]) {
    const view = fixture({ authStatus: "authenticated", error });
    view.render();
    assert.match(view.text(), /Signed in/);
    assert.doesNotMatch(
      view.text(),
      /Sign-in was cancelled|Sign in again|Session expired/,
    );
    assert.equal(
      view.buttons("Request account deletion")[0].props.disabled,
      false,
    );
  }
  const failed = fixture({ error: "local_save_failed" });
  failed.render();
  assert(
    failed.nodes().some((node) => node.props?.accessibilityRole === "alert"),
  );
});

test("delete confirmation isolates old errors and shows only its own failed attempt", async () => {
  const view = fixture({
    error: "request_failed",
    deleteAccount: async () => {
      throw new Error("local_save_failed");
    },
  });
  view.render();
  const oldAlert = view
    .nodes()
    .find((node) => node.props?.accessibilityRole === "alert").props.children;
  view.buttons("Request account deletion")[0].props.onPress();
  view.render();
  assert(!view.modalText().includes(oldAlert));
  view
    .nodes()
    .find((node) => node.props?.accessibilityRole === "checkbox")
    .props.onPress();
  view.render();
  view.buttons("Request account deletion").at(-1).props.onPress();
  await tick();
  view.render();
  assert.match(view.modalText(), /could not be saved on this device/i);
  view.buttons("Cancel")[0].props.onPress();
  view.render();
  view.buttons("Request account deletion")[0].props.onPress();
  view.render();
  assert.doesNotMatch(view.modalText(), /could not be saved on this device/i);
});

test("an open delete confirmation follows session expiry and cannot submit", () => {
  const view = fixture();
  view.render();
  view.buttons("Request account deletion")[0].props.onPress();
  view.render();
  view
    .nodes()
    .find((node) => node.props?.accessibilityRole === "checkbox")
    .props.onPress();
  view.controller.authStatus = "reauth_required";
  view.controller.error = "sign_in_cancelled";
  view.render();
  assert.match(view.modalText(), /Session expired/);
  assert.doesNotMatch(view.modalText(), /Sign-in was cancelled/);
  const submit = view.buttons("Request account deletion").at(-1);
  assert.equal(submit.props.disabled, true);
  submit.props.onPress();
  assert.equal(view.calls.length, 0);
});

test("onboarding is shown only before joining, including while an existing family is being verified", () => {
  for (const locale of ["en", "zh-CN"]) {
    const introduction =
      locale === "en" ? /Creating a family shares/ : /首次创建将共享/;
    const preview = locale === "en" ? /UI preview only/ : /仅供界面预览/;
    for (const role of ["owner", "caregiver"]) {
      const view = fixture({}, locale, false, "family");
      view.render();
      assert.match(view.text(), introduction);
      view.controller.snapshot = snapshot(role);
      view.render();
      assert.doesNotMatch(view.text(), introduction);
      view.controller.sharedMode = true;
      view.render();
      assert.doesNotMatch(view.text(), introduction);
      view.controller.snapshot = null;
      view.controller.authStatus = "unverified";
      view.render();
      assert.doesNotMatch(view.text(), introduction);
      view.controller.sharedMode = false;
      view.controller.authStatus = "authenticated";
      view.render();
      assert.match(view.text(), introduction);
      assert.equal(view.calls.length, 0);

      const demo = fixture(
        { snapshot: snapshot(role), sharedMode: true },
        locale,
        true,
        "family",
      );
      demo.render();
      assert.match(demo.text(), preview);
    }
  }
});

test("unshared-change notices identify the actual section below on the family page", () => {
  for (const locale of ["en", "zh-CN"]) {
    for (const section of ["account", "family"]) {
      const view = fixture(
        { snapshot: snapshot(), notice: "change_not_shared" },
        locale,
        false,
        section,
      );
      view.render();
      assert.match(
        view.text(),
        locale === "en"
          ? /Sharing issues and preserved changes.*further down the Family sharing page/
          : /家庭共享.*页面下方的「共享问题与保留的修改」/,
      );
      assert.doesNotMatch(
        view.text(),
        /Private changes to review|需要检查的私人修改/,
      );
      assert.equal(view.controller.notice, "change_not_shared");
      assert.equal(view.calls.length, 0);
    }
  }
});

test("legacy-only preserved feed notices still name their own review section", () => {
  for (const locale of ["en", "zh-CN"]) {
    const view = fixture(
      {
        snapshot: snapshot(),
        notice: "change_not_shared",
        recordConflicts: [],
        conflicts: [{ operation: { operationId: "legacy-delete" } }],
      },
      locale,
      false,
      "family",
    );
    view.render();
    assert.match(
      view.text(),
      locale === "en"
        ? /Private changes to review \(1\).*further down the Family sharing page/
        : /页面下方的「需要检查的私人修改（1）」/,
    );
    assert.equal(view.controller.conflicts.length, 1);
    assert.equal(view.calls.length, 0);
  }
});

test("joined-family creation guidance starts collapsed and can be expanded and closed", () => {
  for (const locale of ["en", "zh-CN"]) {
    for (const role of ["owner", "caregiver"]) {
      const view = fixture(
        { snapshot: snapshot(role) },
        locale,
        false,
        "family",
        false,
      );
      const title = locale === "en" ? "Create a family group" : "创建家庭群组";
      const message =
        locale === "en"
          ? /already belong to a family group/
          : /已加入一个家庭群组/;
      const toggle = (expanded) =>
        view
          .nodes()
          .find(
            (node) =>
              node.props?.accessibilityLabel ===
              (locale === "en"
                ? `${expanded ? "Hide" : "Show"} ${title}`
                : `${expanded ? "收起" : "展开"}${title}`),
          );
      view.render();
      assert.doesNotMatch(view.text(), message);
      assert.equal(toggle(false)?.props.accessibilityState.expanded, false);
      toggle(false).props.onPress();
      view.render();
      assert.match(view.text(), message);
      assert.equal(toggle(true)?.props.accessibilityState.expanded, true);
      toggle(true).props.onPress();
      view.render();
      assert.doesNotMatch(view.text(), message);
      assert.equal(view.calls.length, 0);
    }
  }
});

test("family members see why they cannot create another group", () => {
  for (const locale of ["en", "zh-CN"]) {
    for (const role of ["owner", "caregiver"]) {
      const view = fixture({ snapshot: snapshot(role) }, locale);
      view.render();
      assert.match(
        view.text(),
        locale === "en"
          ? /already belong to a family group/
          : /已加入一个家庭群组/,
      );
      assert.match(
        view.text(),
        locale === "en"
          ? /lose access to its records/
          : /无法再查看该家庭的记录/,
      );
      assert.match(
        view.text(),
        locale === "en"
          ? role === "owner"
            ? /transfer administration/
            : /leave your current family/
          : role === "owner"
            ? /转让管理员/
            : /退出当前家庭/,
      );
      assert.equal(
        view.buttons(locale === "en" ? "Create a family" : "创建家庭").length,
        0,
      );
    }
  }
});

test("invitation acceptance requires explicit warning acknowledgement in both languages", async () => {
  for (const locale of ["en", "zh-CN"]) {
    const label = locale === "en" ? "Accept invitation" : "接受邀请";
    const screen = fixture(
      {
        inbox: [
          {
            id: "invite",
            familyId: "family",
            ownerDisplayName: "Admin",
            expiresAt: "2027-01-01T00:00:00Z",
          },
        ],
      },
      locale,
    );
    screen.render();
    assert(
      !screen
        .nodes()
        .some((node) => node.props?.accessibilityLabel === "Invitation link"),
    );
    screen.buttons(label)[0].props.onPress();
    screen.render();
    assert.match(
      screen.text(),
      locale === "en" ? /without advance notice/ : /无需提前通知/,
    );
    assert.match(
      screen.text(),
      locale === "en" ? /never uploaded or merged/ : /不会上传或合并/,
    );
    assert.match(
      screen.text(),
      locale === "en"
        ? /automatically decline all other pending invitations/
        : /自动拒绝.*其他待处理邀请/,
    );
    assert.equal(screen.buttons(label).at(-1).props.disabled, true);
    assert.equal(screen.calls.length, 0);
    screen
      .buttons(locale === "en" ? "Cancel" : "取消")
      .at(-1)
      .props.onPress();
    screen.render();
    assert.equal(
      screen.calls.length,
      0,
      "Cancelling must not accept or decline any invitation",
    );
    screen.buttons(label)[0].props.onPress();
    screen.render();
    assert.equal(screen.buttons(label).at(-1).props.disabled, true);
    const consent = screen
      .nodes()
      .findLast((node) => node.props?.accessibilityRole === "checkbox");
    assert.match(
      consent.props.accessibilityLabel,
      locale === "en"
        ? /decline.*other pending invitations/
        : /拒绝.*其他待处理邀请/,
    );
    consent.props.onPress();
    screen.render();
    assert.equal(screen.buttons(label).at(-1).props.disabled, false);
    screen.buttons(label).at(-1).props.onPress();
    await tick();
    assert.equal(
      screen.calls.filter((call) => call.name === "acceptInvitation").length,
      1,
    );
    assert.equal(screen.calls[0].args[0], "invite");
  }
});

test("accepted invitations show the outcome of their own membership without relabeling a reinvitation", () => {
  for (const locale of ["en", "zh-CN"]) {
    const data = snapshotWithMemberHistory("owner");
    data.members.push({
      ...data.members[1],
      membershipId: "rejoined-grant",
      status: "active",
      endedAt: null,
    });
    const accepted = (id, acceptedMembershipId) => ({
      id,
      email: "removed@example.invalid",
      expiresAt: "2027-01-01T00:00:00Z",
      status: "accepted",
      acceptedMembershipId,
    });
    data.invitations = [
      accepted("old-accepted", "removed-grant"),
      accepted("current-accepted", "rejoined-grant"),
      accepted("left-accepted", "former-grant"),
      { ...accepted("new-pending", null), status: "pending" },
      accepted("legacy-accepted", undefined),
    ];
    const view = fixture({ snapshot: data }, locale, false, "family", false);
    view.render();
    view
      .nodes()
      .find(
        (node) =>
          node.props?.accessibilityLabel ===
          (locale === "en" ? "Show Invitations" : "展开邀请记录"),
      )
      .props.onPress();
    view.render();
    const lines = view.text().split("\n");
    for (const [message, count] of [
      [locale === "en" ? "Accepted · later removed" : "已接受 · 后已移除", 1],
      [locale === "en" ? "Accepted · later left" : "已接受 · 后已退出", 1],
      [locale === "en" ? "Accepted" : "已接受", 2],
      [locale === "en" ? "Waiting for acceptance" : "待接受", 1],
    ])
      assert.equal(
        lines.filter((line) => line === message).length,
        count,
        message,
      );
    assert.equal(view.buttons(locale === "en" ? "Revoke" : "撤销").length, 1);
    assert.doesNotMatch(view.text(), /Removed caregiver|Former caregiver/);
    assert.doesNotMatch(
      view.text(),
      /Unlinked membership history|未关联邀请的成员历史/,
    );
    assert.equal(
      lines.filter((line) =>
        line.startsWith(locale === "en" ? "Expires " : "到期："),
      ).length,
      1,
    );
  }
});

test("invitation history stays collapsed when the invite form opens and preserves unbound legacy membership rows", () => {
  for (const locale of ["en", "zh-CN"]) {
    const data = snapshotWithMemberHistory("owner");
    data.invitations = [
      {
        id: "legacy-accepted",
        email: "removed@example.invalid",
        status: "accepted",
        expiresAt: "2027-01-01T00:00:00Z",
      },
      {
        id: "reinvite",
        email: "removed@example.invalid",
        status: "pending",
        expiresAt: "2027-01-01T00:00:00Z",
      },
    ];
    const view = fixture({ snapshot: data }, locale, false, "family", false);
    const toggle = (en, zh) =>
      view
        .nodes()
        .find(
          (node) =>
            node.props?.accessibilityLabel === (locale === "en" ? en : zh),
        );
    view.render();
    toggle("Show Invite a caregiver", "展开邀请照护者").props.onPress();
    view.render();
    assert.equal(
      toggle("Show Invitations", "展开邀请记录")?.props.accessibilityState
        .expanded,
      false,
    );
    assert.doesNotMatch(
      view.text(),
      /removed@example.invalid|Removed caregiver|Former caregiver/,
    );
    toggle("Show Invitations", "展开邀请记录").props.onPress();
    view.render();
    const lines = view.text().split("\n");
    assert.equal(
      lines.filter((line) => line === (locale === "en" ? "Accepted" : "已接受"))
        .length,
      1,
    );
    assert.doesNotMatch(
      view.text(),
      /Accepted · later removed|已接受 · 后已移除/,
    );
    assert.match(view.text(), /Removed caregiver/);
    assert.match(view.text(), /Former caregiver/);
    assert.equal(view.buttons(locale === "en" ? "Revoke" : "撤销").length, 1);
    toggle("Hide Invitations", "收起邀请记录").props.onPress();
    view.render();
    assert.doesNotMatch(
      view.text(),
      /removed@example.invalid|Removed caregiver|Former caregiver/,
    );
    assert.equal(
      view.buttons(locale === "en" ? "Add invitation" : "添加邀请").length,
      1,
    );
    assert.equal(view.calls.length, 0);
  }
});

test("invitation history distinguishes automatic decline after joining from manual decline", () => {
  for (const locale of ["en", "zh-CN"]) {
    const data = snapshot("owner");
    data.invitations = [
      {
        id: "declined-invite",
        email: "relative@example.invalid",
        expiresAt: "2027-01-01T00:00:00Z",
        status: "declined",
        declineReason: "joined_family",
      },
    ];
    const screen = fixture({ snapshot: data }, locale);
    screen.render();
    assert.match(
      screen.text(),
      locale === "en"
        ? /recipient joined another family group/
        : /对方加入了其他家庭群组/,
    );
    assert.equal(screen.buttons(locale === "en" ? "Revoke" : "撤销").length, 0);
  }
});

test("isolated demo members see edit/delete only for their own records and no admin writes", () => {
  const screen = fixture(
    {
      snapshot: snapshot(),
      feeds: [feed("own", "user"), feed("other", "another")],
    },
    "en",
    true,
  );
  screen.render();
  assert.equal(screen.buttons("Edit").length, 1);
  assert.equal(screen.buttons("Delete").length, 1);
  assert.equal(screen.buttons("Save baby profile").length, 0);
  assert.equal(screen.buttons("Add invitation").length, 0);
});

test("isolated demo admins can change any feed and profile but cannot delete their account while owning a family", () => {
  const screen = fixture(
    {
      snapshot: snapshot("owner"),
      feeds: [feed("own", "user"), feed("other", "another")],
    },
    "en",
    true,
  );
  screen.render();
  assert.equal(screen.buttons("Edit").length, 2);
  assert.equal(screen.buttons("Delete").length, 2);
  assert.equal(screen.buttons("Save baby profile").length, 1);
  assert.equal(screen.buttons("Add invitation").length, 1);
  assert.equal(
    screen.buttons("Request account deletion")[0].props.disabled,
    true,
  );
});

test("uncertain membership transitions hide family records and offer refresh", () => {
  const screen = fixture({
    transitionPending: true,
    feeds: [feed("hidden", "user")],
  });
  screen.render();
  assert.match(screen.text(), /Confirming a family change/);
  assert.equal(screen.buttons("Add test bottle feed").length, 0);
  assert.equal(screen.buttons("Edit").length, 0);
  assert(screen.buttons("Refresh").length > 0);
});

test("deletion receipt progress remains available after sign-out without claiming completion", () => {
  const screen = fixture({
    user: null,
    deletionStatus: {
      deletionId: "deletion",
      status: "awaiting_identity_deletion",
      requestedAt: "2026-09-01T01:00:00Z",
    },
  });
  screen.render();
  assert.equal(screen.buttons("Check deletion status").length, 1);
  assert.equal(screen.buttons("Sign in to the pilot").length, 0);
  assert.match(screen.text(), /not yet confirmed deleted/);
  assert.doesNotMatch(screen.text(), /Account deletion completed/);
});

test("unconfirmed transition sign-out discloses discarded local work and cancellation preserves it in both languages", async () => {
  for (const locale of ["en", "zh-CN"]) {
    for (const section of ["account", "family"]) {
      for (const deletionStatus of [
        null,
        {
          deletionId: "deletion",
          status: "pending",
          requestedAt: "2026-09-01T01:00:00Z",
        },
      ]) {
        const screen = fixture(
          { transitionPending: true, deletionStatus, hasPrivateWork: true },
          locale,
          false,
          section,
        );
        const signOut = locale === "en" ? "Sign out" : "退出登录";
        const cancel = locale === "en" ? "Cancel" : "取消";
        screen.render();
        assert.equal(screen.buttons(signOut).length, 1);
        assert.equal(screen.buttons(signOut)[0].props.disabled, false);
        screen.buttons(signOut)[0].props.onPress();
        screen.render();
        assert.match(
          screen.modalText(),
          locale === "en"
            ? /may have completed on the server/
            : /服务端可能已经完成/,
        );
        assert.match(
          screen.modalText(),
          locale === "en"
            ? /discards.*family cache, drafts, unsent changes and retry intent/
            : /丢弃.*家庭缓存、草稿、未发送修改和重试意图/,
        );
        assert.match(
          screen.modalText(),
          locale === "en"
            ? /does not undo.*accepted.*server/
            : /不会撤销服务端已接受的操作/,
        );
        assert.match(
          screen.modalText(),
          locale === "en"
            ? /account-deletion receipt.*kept/i
            : /账户删除查询凭证会保留/,
        );
        assert.equal(screen.calls.length, 0);
        screen.buttons(cancel)[0].props.onPress();
        screen.render();
        assert.equal(screen.modalText(), "");
        assert.equal(
          screen.calls.length,
          0,
          "Cancelling must not sign out or discard local work",
        );
        assert.equal(screen.controller.hasPrivateWork, true);
        assert.equal(screen.controller.transitionPending, true);
        assert.equal(screen.controller.deletionStatus, deletionStatus);
        screen.buttons(signOut)[0].props.onPress();
        screen.render();
        const confirmation = screen.buttons(signOut).at(-1);
        assert.equal(confirmation.props.disabled, false);
        confirmation.props.onPress();
        await tick();
        assert.equal(
          screen.calls.filter((call) => call.name === "signOut").length,
          1,
        );
      }
    }
  }
});

test("real family management never offers the legacy test feed editor or synthetic create fallback", () => {
  for (const role of ["caregiver", "owner"]) {
    const screen = fixture({
      snapshot: snapshot(role),
      feeds: [feed("old", "user")],
    });
    screen.render();
    assert.equal(screen.buttons("Edit").length, 0);
    assert.equal(screen.buttons("Save baby profile").length, 0);
    assert.equal(screen.buttons("Add test bottle feed").length, 0);
    assert.doesNotMatch(screen.text(), /All family records are connected/);
    assert.equal(
      screen.buttons("Add invitation").length,
      role === "owner" ? 1 : 0,
    );
  }
  const noFamily = fixture();
  noFamily.render();
  assert.doesNotMatch(noFamily.text(), /Create a test family|fictional data/);
});

test("unresolved create and join keep sign-out blocked so their activation journals can recover", () => {
  const screen = fixture({ transitionPending: true, activationPending: true });
  screen.render();
  assert(screen.buttons("Sign out").length > 0);
  assert(screen.buttons("Sign out").every((button) => button.props.disabled));
  assert(screen.buttons("Refresh").length > 0);
});
