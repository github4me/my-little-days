import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Exercise the real components against deterministic native/controller boundaries.
// Device layout and screen-reader announcements still require device validation.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const origin = {
  userId: "a",
  familyId: "f",
  membershipId: "m",
  historyId: "h",
};
const conflict = (id = "operation-a") => ({
  origin,
  status: "failed",
  error: "record_changed",
  operation: {
    operationId: id,
    recordId: `record-${id}`,
    kind: "update",
    collection: "entry",
    entry: {
      id: `record-${id}`,
      type: "feed",
      start: "2026-09-16T01:00:00.000Z",
      note: "Preserved note",
      amount: 90,
    },
  },
});

function fixture(overrides = {}, locale = "en") {
  let active = "",
    slot = 0,
    nodes = [],
    effects = [];
  const values = new Map(),
    dependencies = new Map(),
    calls = [];
  const palette = {
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
            ? { children: children.length === 1 ? children[0] : children }
            : {}),
        },
      };
    },
    useContext: () => palette,
    useEffect(callback, deps) {
      const key = `${active}:effect:${slot++}`;
      const previous = dependencies.get(key);
      if (
        !previous ||
        deps.some((value, index) => !Object.is(value, previous[index]))
      ) {
        dependencies.set(key, deps);
        effects.push(callback);
      }
    },
    useState(initial) {
      const key = `${active}:state:${slot++}`;
      if (!values.has(key))
        values.set(key, typeof initial === "function" ? initial() : initial);
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
      ["View", "Pressable", "Modal", "ScrollView"].map((name) => [name, name]),
    ),
    StyleSheet: { create: (styles) => styles },
  };
  const pilot = {
    user: { id: origin.userId },
    snapshot: {
      family: { id: origin.familyId, membershipId: origin.membershipId },
      historyId: origin.historyId,
    },
    fullSnapshot: {
      family: { id: origin.familyId, membershipId: origin.membershipId },
      historyId: origin.historyId,
    },
    ready: true,
    sharedMode: true,
    authStatus: "authenticated",
    error: null,
    notice: null,
    recordConflicts: [],
    conflicts: [],
    recordPending: [],
    pending: [],
    busy: false,
    syncing: false,
    transitionPending: false,
    discardRecordConflict: async (id) =>
      calls.push({ name: "discardRecordConflict", id }),
    discardConflict: async (id) => calls.push({ name: "discardConflict", id }),
    ...overrides,
  };
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
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
    const module = { exports: {} };
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
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
        if (name === "../i18n") return { useI18n: () => ({ locale }) };
        if (name === "../ui") return ui;
        if (name === "./messages") return load("src/family/messages.ts");
        if (name === "./syncIssues") return load("src/family/syncIssues.ts");
        throw new Error(`Unexpected sync component dependency: ${name}`);
      },
    });
    cache.set(relative, module.exports);
    return module.exports;
  }
  const components = load("src/family/FamilySyncStatus.tsx");
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
  const world = {
    pilot,
    calls,
    render(kind = "FamilySyncBanner") {
      nodes = [];
      effects = [];
      visit(
        react.createElement(components[kind], {
          pilot,
          onOpenFamily: () => calls.push({ name: "openFamily" }),
        }),
      );
      effects.forEach((effect) => effect());
      return nodes;
    },
    buttons: (label) =>
      nodes.filter(
        (node) => node.type === "Button" && node.props.label === label,
      ),
    close: () =>
      nodes.find(
        (node) =>
          node.type === "Pressable" &&
          ["Dismiss family sharing notice", "关闭家庭共享提示"].includes(
            node.props.accessibilityLabel,
          ),
      ),
    text: () =>
      nodes
        .filter((node) => node.text)
        .map((node) => node.text)
        .join("\n"),
    nodes: () => nodes,
  };
  return world;
}

test("normal idle, pending and syncing states render no banner", () => {
  for (const overrides of [
    {},
    { recordPending: [conflict()] },
    { syncing: true, notice: "saved_locally" },
  ]) {
    const world = fixture(overrides);
    assert.deepEqual(world.render(), []);
  }
});

test("closing the banner preserves errors and conflicts across polling; review opens family sharing", () => {
  const world = fixture({
    error: "network_unavailable",
    recordConflicts: [conflict()],
  });
  world.render();
  world.buttons("Review family sharing")[0].props.onPress();
  assert.deepEqual(world.calls, [{ name: "openFamily" }]);
  const close = world.close();
  const style = Object.assign({}, ...close.props.style({ pressed: false }));
  assert.ok(style.minHeight >= 44 && style.minWidth >= 44);
  close.props.onPress();
  for (let poll = 0; poll < 3; poll++) {
    world.pilot.recordConflicts = [conflict()];
    assert.deepEqual(world.render(), []);
  }
  assert.equal(world.pilot.error, "network_unavailable");
  assert.equal(world.pilot.recordConflicts.length, 1);
  assert.deepEqual(world.calls, [{ name: "openFamily" }]);
  world.pilot.recordConflicts.push(conflict("operation-b"));
  world.render();
  assert.ok(world.close());
});

test("resolved then recurring network failure appears again without claiming instant offline detection", () => {
  const world = fixture({ error: "network_unavailable" });
  world.render();
  assert.match(world.text(), /cannot be reached/);
  world.close().props.onPress();
  world.render();
  world.pilot.error = null;
  world.render();
  world.pilot.error = "network_unavailable";
  world.render();
  assert.ok(world.close());
});

test("dismissed conflict remains reachable in details; only confirmed discard calls the controller", async () => {
  const world = fixture({ recordConflicts: [conflict()] });
  world.render();
  world.close().props.onPress();
  assert.deepEqual(world.render(), []);
  world.render("FamilySyncDetails");
  assert.match(world.text(), /Preserved note/);
  world.buttons("Discard this change")[0].props.onPress();
  world.render("FamilySyncDetails");
  assert.match(world.text(), /Discard this preserved change\?/);
  assert.equal(world.calls.length, 0);
  world.buttons("Cancel")[0].props.onPress();
  world.render("FamilySyncDetails");
  assert.equal(world.calls.length, 0);
  assert.equal(world.pilot.recordConflicts.length, 1);
  world.buttons("Discard this change")[0].props.onPress();
  world.render("FamilySyncDetails");
  world.buttons("Discard this change").at(-1).props.onPress();
  await tick();
  assert.deepEqual(world.calls, [
    { name: "discardRecordConflict", id: "operation-a" },
  ]);
});

test("changing family context closes a stale discard confirmation", () => {
  const world = fixture({ recordConflicts: [conflict()] });
  world.render("FamilySyncDetails");
  world.buttons("Discard this change")[0].props.onPress();
  const changed = conflict();
  changed.origin = { ...origin, familyId: "new-family" };
  world.pilot.recordConflicts = [changed];
  world.render("FamilySyncDetails");
  assert.ok(!world.nodes().some((node) => node.type === "Modal"));
  assert.equal(world.calls.length, 0);
});

test("unverified access and mismatched origins hide conflict payloads and discard controls", () => {
  for (const overrides of [
    { authStatus: "reauth_required" },
    { authStatus: "unverified" },
    { ready: false },
    { fullSnapshot: null },
    { user: { id: "another-account" } },
    {
      fullSnapshot: {
        family: { id: "another-family", membershipId: origin.membershipId },
        historyId: origin.historyId,
      },
    },
  ]) {
    const world = fixture({ recordConflicts: [conflict()], ...overrides });
    world.render("FamilySyncDetails");
    assert.doesNotMatch(world.text(), /Preserved note|Feed|2026/);
    assert.equal(world.buttons("Discard this change").length, 0);
  }
});

test("authentication expiry closes an open discard modal without invoking the controller", () => {
  const world = fixture({ recordConflicts: [conflict()] });
  world.render("FamilySyncDetails");
  world.buttons("Discard this change")[0].props.onPress();
  world.render("FamilySyncDetails");
  assert.ok(world.nodes().some((node) => node.type === "Modal"));
  world.pilot.authStatus = "reauth_required";
  world.pilot.ready = false;
  world.pilot.fullSnapshot = null;
  world.render("FamilySyncDetails");
  assert.ok(!world.nodes().some((node) => node.type === "Modal"));
  assert.equal(world.buttons("Discard this change").length, 0);
  assert.doesNotMatch(world.text(), /Preserved note|Feed|2026/);
  assert.equal(world.calls.length, 0);
});

test("Chinese failures, dismissal and conflict actions are localized", () => {
  const world = fixture(
    { error: "service_unavailable", recordConflicts: [conflict()] },
    "zh-CN",
  );
  world.render();
  assert.equal(world.close().props.accessibilityLabel, "关闭家庭共享提示");
  assert.equal(world.buttons("查看家庭共享").length, 1);
  assert.match(world.text(), /暂时无法连接家庭共享服务/);
  world.render("FamilySyncDetails");
  assert.equal(world.buttons("丢弃此修改").length, 1);
});
