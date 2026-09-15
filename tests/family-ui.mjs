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
    assert.equal(screen.buttons(label).at(-1).props.disabled, true);
    assert.equal(screen.calls.length, 0);
    const consent = screen
      .nodes()
      .findLast((node) => node.props?.accessibilityRole === "checkbox");
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
