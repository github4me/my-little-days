import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Run the real screen against a deterministic React Native/controller boundary.
// Disclosures are expanded to inspect their contents. These checks cover access
// controls and confirmation wiring, not React scheduling, layout or a real device.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(overrides = {}, locale = "en", demo = false) {
  let active = "",
    slot = 0,
    nodes = [];
  const values = new Map(),
    refs = new Map(),
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
    useEffect: () => {},
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
          active.endsWith("Disclosure")
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
    render() {
      nodes = [];
      visit(
        react.createElement(Screen, { onBack() {}, pilot: controller, demo }),
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

test("unresolved transitions still allow explicit sign-out, including a pending account deletion", async () => {
  for (const deletionStatus of [
    null,
    {
      deletionId: "deletion",
      status: "pending",
      requestedAt: "2026-09-01T01:00:00Z",
    },
  ]) {
    const screen = fixture({ transitionPending: true, deletionStatus });
    screen.render();
    assert.equal(screen.buttons("Sign out").length, 1);
    assert.equal(screen.buttons("Sign out")[0].props.disabled, false);
    screen.buttons("Sign out")[0].props.onPress();
    screen.render();
    assert.match(screen.text(), /may have completed on the server/);
    assert.equal(screen.calls.length, 0);
    const confirmation = screen.buttons("Sign out").at(-1);
    assert.equal(confirmation.props.disabled, false);
    confirmation.props.onPress();
    await tick();
    assert.equal(
      screen.calls.filter((call) => call.name === "signOut").length,
      1,
    );
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
