import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
const root = process.cwd();
const tick = () => new Promise((resolve) => setImmediate(resolve));
function view(overrides = {}) {
  const values = [],
    refs = [],
    calls = [];
  let cursor = 0,
    nodes = [];
  const props = {
    records: [],
    enabled: false,
    notificationError: null,
    canEdit: () => true,
    onEnable: async (enabled) => calls.push(["enable", enabled]),
    onSave: async (record, version) => calls.push(["save", record, version]),
    onDelete: async (id, version) => calls.push(["delete", id, version]),
    ...overrides,
  };
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    useContext: () => ({ muted: "#567", line: "#abc" }),
    useEffect: () => {},
    useRef: (initial) => {
      const i = cursor++;
      return (refs[i] ??= { current: initial });
    },
    useState: (initial) => {
      const i = cursor++;
      if (!(i in values))
        values[i] = typeof initial === "function" ? initial() : initial;
      return [
        values[i],
        (value) => {
          values[i] = typeof value === "function" ? value(values[i]) : value;
        },
      ];
    },
  };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      Date,
      Number,
      String,
      Set,
      Map,
      require(name) {
        if (name === "../NativeDateTimeField") return "Field";
        if (name === "react") return react;
        if (name === "react-native")
          return {
            View: "View",
            Switch: "Switch",
            Pressable: "Pressable",
            Platform: { OS: "ios" },
          };
        if (name === "react-native-svg")
          return { __esModule: true, default: "Svg", Path: "Path" };
        if (name === "expo-crypto") return { randomUUID: () => "new-reminder" };
        if (name === "../ui" || name === "./ui")
          return {
            Theme: {},
            ...Object.fromEntries(
              ["T", "Button", "Field", "Chips", "Card"].map((v) => [v, v]),
            ),
            row: {},
          };
        if (name === "../i18n") return { useI18n: () => ({ locale: "en-US" }) };
        const base = path.resolve(path.dirname(filename), name);
        return load([base + ".ts", base + ".tsx"].find(fs.existsSync));
      },
    });
    cache.set(filename, module.exports);
    return module.exports;
  }
  const Screen = load(
    path.join(root, "src/family/SharedReminders.tsx"),
  ).default;
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (typeof node.type === "function") return walk(node.type(node.props));
    nodes.push(node);
    walk(node.props.children);
  }
  const render = () => {
    cursor = 0;
    nodes = [];
    walk(Screen(props));
  };
  render();
  return {
    calls,
    render,
    nodes: () => nodes,
    button: (label) =>
      nodes.find(
        (n) =>
          (n.type === "Button" && n.props.label === label) ||
          (n.type === "Pressable" && n.props.accessibilityLabel === label),
      ),
    field: (label) =>
      nodes.find((n) => n.type === "Field" && n.props.label === label),
  };
}
test("shared reminder draft does not save or enable device delivery until explicit action", async () => {
  const screen = view();
  screen.field("Title").props.onChange("Bottle reminder");
  screen.field("Minutes").props.onChange("20");
  screen.render();
  assert.equal(screen.calls.length, 0);
  await screen.button("Save reminder").props.onPress();
  await tick();
  screen.render();
  assert.equal(screen.calls.length, 1);
  assert.equal(screen.calls[0][0], "save");
  assert.equal(screen.calls[0][1].settings.minutes, 20);
  assert.equal(screen.calls[0][1].settings.title, "Bottle reminder");
  assert.ok(Date.parse(screen.calls[0][1].onceAt) > Date.now());
  await screen.button("Enable on this phone").props.onPress();
  await tick();
  assert.equal(screen.calls[1][0], "enable");
});
test("shared reminder delete is permission gated and needs confirmation", async () => {
  const record = {
    id: "r1",
    kind: "reminder",
    settings: {
      kind: "feed",
      mode: "daily",
      title: "Feed",
      minutes: 120,
      dailyTime: "09:00",
      silent: true,
    },
  };
  const props = {
    records: [
      { record, version: "v1", recordedBy: "other", lastEditedBy: "other" },
    ],
  };
  const denied = view({ ...props, canEdit: () => false });
  assert.equal(
    denied.button("Delete family reminder: Feed")?.props.disabled,
    true,
  );
  assert.equal(
    denied.button("Delete family reminder: Feed")?.props.onPress,
    undefined,
  );
  const screen = view(props);
  assert.equal(
    screen.button("Delete family reminder: Feed").props.children[0].type,
    "Svg",
  );
  screen.button("Delete family reminder: Feed").props.onPress();
  screen.render();
  assert.equal(screen.calls.length, 0);
  await screen.button("Confirm delete").props.onPress();
  await tick();
  assert.deepEqual(screen.calls, [["delete", "r1", "v1"]]);
});

test("daily reminders save when the now-hidden once interval is empty or invalid", async () => {
  for (const minutes of ["", "0", "10081", "not-a-number"]) {
    const screen = view();
    screen.field("Minutes").props.onChange(minutes);
    screen.render();
    screen
      .nodes()
      .find(
        (node) =>
          node.type === "Chips" &&
          node.props.options.some((option) => option.value === "daily"),
      )
      .props.onChange("daily");
    screen.render();
    assert.equal(screen.field("Minutes"), undefined);
    screen.field("Daily time · HH:mm").props.onChange("21:30");
    screen.render();
    await screen.button("Save reminder").props.onPress();
    await tick();
    assert.equal(
      screen.calls.length,
      1,
      `daily save blocked by hidden interval ${JSON.stringify(minutes)}`,
    );
    assert.equal(screen.calls[0][0], "save");
    assert.equal(screen.calls[0][1].settings.mode, "daily");
    assert.equal(screen.calls[0][1].settings.dailyTime, "21:30");
    assert.equal(screen.calls[0][1].settings.minutes, 120);
    assert.equal(screen.calls[0][1].onceAt, undefined);
  }
});
