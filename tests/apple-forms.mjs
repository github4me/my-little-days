import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Real component state/event wiring at the native boundary. This cannot prove
// physical VoiceOver focus, keyboard behavior, or native wheel rendering.
function fixture(component, platform = "ios", fontScale = 1, overrides = {}) {
  const states = [],
    refs = [],
    callbacks = [],
    cache = new Map();
  let slot = 0,
    nodes = [],
    keyboardDismissals = 0,
    closed = 0,
    saved;
  const changed = [];
  const entry = {
    id: "feed-1",
    type: "feed",
    start: new Date(2026, 8, 18, 10, 4).toISOString(),
    amount: 120,
    feedKind: "formula",
    note: "",
  };
  const props = {
    entry,
    birthDate: "2026-07-01",
    stoppedAt: new Date(2026, 8, 18, 10, 20).toISOString(),
    dark: true,
    onClose() {
      closed++;
    },
    onCancel() {},
    onSave: async (value) => {
      saved = value;
    },
    ...(component === "NativeDateTimeField"
      ? {
          label: "出生日期 · 可暂不填写",
          mode: "date",
          value: "2026-07-01",
          optional: true,
          minimumDate: new Date(1900, 0, 1),
          maximumDate: new Date(2026, 8, 18, 12),
          onChange: (value) => changed.push(value),
        }
      : {}),
    ...overrides,
  };
  const palette = {
    isDark: true,
    primary: "#8bc",
    text: "#fff",
    card: "#222",
    elevated: "#333",
    input: "#222",
  };
  const translate = (text, values = {}) =>
    Object.entries(values).reduce(
      (copy, [key, value]) => copy.replace(`{${key}}`, value),
      text,
    );
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    useContext: () => palette,
    useState(initial) {
      const key = slot++;
      if (!(key in states))
        states[key] = typeof initial === "function" ? initial() : initial;
      return [
        states[key],
        (value) => {
          states[key] =
            typeof value === "function" ? value(states[key]) : value;
        },
      ];
    },
    useRef(initial) {
      const key = slot++;
      return (refs[key] ??= { current: initial });
    },
    useCallback(callback, dependencies) {
      const key = slot++,
        previous = callbacks[key];
      if (
        !previous ||
        dependencies.some(
          (value, index) => !Object.is(value, previous.dependencies[index]),
        )
      )
        callbacks[key] = { callback, dependencies };
      return callbacks[key].callback;
    },
    useMemo: (callback) => callback(),
    useEffect() {},
  };
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
      setTimeout,
      clearTimeout,
      require(name) {
        if (name === "react") return react;
        if (name === "react-native")
          return {
            ...Object.fromEntries(
              [
                "ActivityIndicator",
                "KeyboardAvoidingView",
                "Pressable",
                "ScrollView",
                "Switch",
                "Text",
                "TextInput",
                "View",
              ].map((name) => [name, name]),
            ),
            Platform: { OS: platform },
            Linking: {},
            Keyboard: { dismiss: () => keyboardDismissals++ },
            StyleSheet: { create: (styles) => styles },
            useWindowDimensions: () => ({ width: 390, height: 844, fontScale }),
          };
        if (name === "react-native-safe-area-context")
          return {
            SafeAreaProvider: "SafeAreaProvider",
            SafeAreaView: "SafeAreaView",
          };
        if (name === "@react-native-community/datetimepicker")
          return "DateTimePicker";
        if (name === "react-native-svg")
          return { __esModule: true, default: "Svg", Path: "Path" };
        if (name === "./AccessibleModal") return "Modal";
        if (name === "./accessibilityPreferences")
          return {
            useAccessibilityPreferences: () => ({ highContrast: false }),
          };
        if (name === "./palette") return { selectPalette: () => palette };
        if (name === "./ui")
          return { Theme: {}, T: "T", Button: "Button", Field: "Field" };
        if (name === "./i18n")
          return {
            t: translate,
            useI18n: () => ({ locale: "zh-CN", t: translate }),
            elapsed: () => "16 min",
            formatTime: () => "10:20",
          };
        if (name === "./domain")
          return { makeId: () => "entry-new", validateEntry: (value) => value };
        const base = path.resolve(path.dirname(filename), name);
        return load([base + ".ts", base + ".tsx"].find(fs.existsSync));
      },
    });
    cache.set(filename, module.exports);
    return module.exports;
  }
  const Screen = load(path.resolve(`src/${component}.tsx`)).default;
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    walk(node.props.children);
  }
  function render() {
    slot = 0;
    nodes = [];
    walk(Screen(props));
  }
  function content(node) {
    return Array.isArray(node)
      ? node.map(content).join("")
      : typeof node === "string"
        ? node
        : node?.props
          ? content(node.props.children)
          : "";
  }
  render();
  return {
    render,
    props,
    nodes: () => nodes,
    saved: () => saved,
    closed: () => closed,
    changed,
    picker: () => nodes.find((node) => node.type === "DateTimePicker"),
    byLabel: (label) =>
      nodes.find((node) => node.props.accessibilityLabel === label),
    action: (label) =>
      nodes.find(
        (node) => node.type === "Pressable" && content(node) === label,
      ),
    keyboardDismissals: () => keyboardDismissals,
  };
}

test("native editor picker drafts cancel without changing the record and Done applies", () => {
  const screen = fixture("EntryEditor");
  screen.byLabel("记录时间时刻").props.onPress();
  screen.render();
  assert.equal(screen.picker().props.display, "spinner");
  assert.equal(screen.picker().props.themeVariant, "dark");
  screen.picker().props.onChange({ type: "set" }, new Date(2026, 8, 18, 9, 15));
  screen.render();
  assert.equal(
    screen.byLabel("记录时间时刻").props.accessibilityValue.text,
    "10:04",
  );
  screen.action("取消").props.onPress();
  screen.render();
  assert.equal(screen.picker(), undefined);
  assert.equal(
    screen.byLabel("记录时间时刻").props.accessibilityValue.text,
    "10:04",
  );
  screen.byLabel("记录时间时刻").props.onPress();
  screen.render();
  screen.picker().props.onChange({ type: "set" }, new Date(2026, 8, 18, 9, 20));
  screen.render();
  screen.action("完成").props.onPress();
  screen.render();
  assert.equal(
    screen.byLabel("记录时间时刻").props.accessibilityValue.text,
    "09:20",
  );
  assert.equal(screen.keyboardDismissals(), 2);
  assert.equal(screen.saved(), undefined);
});

test("Android editor ignores dismissal values and retains a stable change handler", () => {
  const screen = fixture("EntryEditor", "android");
  screen.byLabel("记录时间时刻").props.onPress();
  screen.render();
  const change = screen.picker().props.onChange;
  screen.render();
  assert.equal(screen.picker().props.onChange, change);
  change({ type: "dismissed" }, new Date(2026, 8, 18, 9, 15));
  screen.render();
  assert.equal(screen.picker(), undefined);
  assert.equal(
    screen.byLabel("记录时间时刻").props.accessibilityValue.text,
    "10:04",
  );
});

test("editor back and accessibility escape cancel the active picker before closing the form", () => {
  for (const dismiss of [
    (screen) =>
      screen.nodes().find((node) => node.type === "Modal").props.onRequestClose,
    (screen) =>
      screen.nodes().find((node) => node.type === "SafeAreaView").props
        .onAccessibilityEscape,
    (screen) => screen.byLabel("关闭记录编辑").props.onPress,
  ]) {
    const screen = fixture("EntryEditor");
    screen.byLabel("记录时间时刻").props.onPress();
    screen.render();
    screen
      .picker()
      .props.onChange({ type: "set" }, new Date(2026, 8, 18, 9, 15));
    screen.render();
    const close = dismiss(screen);
    close();
    // A repeated native escape before React rerenders must not close the form.
    close();
    assert.equal(screen.closed(), 0);
    screen.render();
    assert.equal(screen.picker(), undefined);
    assert.equal(
      screen.byLabel("记录时间时刻").props.accessibilityValue.text,
      "10:04",
    );
    assert.equal(screen.saved(), undefined);
    dismiss(screen)();
    assert.equal(screen.closed(), 1);
  }
});

test("native optional end time is a switch; web retains the existing form action", () => {
  const native = fixture("EntryEditor");
  const toggle = native.byLabel("记录结束时间");
  assert.equal(toggle.type, "Switch");
  assert.equal(toggle.props.value, false);
  toggle.props.onValueChange(true);
  native.render();
  assert.equal(native.byLabel("记录结束时间").props.value, true);
  assert.ok(native.byLabel("结束时间日期"));
  const web = fixture("EntryEditor", "web");
  assert.equal(web.byLabel("记录结束时间"), undefined);
  assert.ok(web.action("+ 记录结束时间（可选）"));
});

test("large type editor permits wrapping instead of clipping choice labels", () => {
  const screen = fixture("EntryEditor", "ios", 2);
  assert.equal(
    screen.nodes().filter((node) => node.props.numberOfLines === 1).length,
    0,
  );
  const feed = screen.byLabel("喂养方式：配方奶");
  assert.ok(
    feed.props
      .style({ pressed: false })
      .some((style) => style?.flexBasis === "44%"),
  );
});

test("milk wheel exposes adjustable value/actions and preserves bounded selection", () => {
  const screen = fixture("FinishFeedDialog");
  let wheel = screen.byLabel("奶量滚轮");
  assert.equal(wheel.props.accessibilityRole, "adjustable");
  assert.equal(wheel.props.accessibilityValue.now, 120);
  wheel.props.onAccessibilityAction({
    nativeEvent: { actionName: "increment" },
  });
  screen.render();
  wheel = screen.byLabel("奶量滚轮");
  assert.equal(wheel.props.accessibilityValue.now, 125);
  wheel.props.onAccessibilityAction({
    nativeEvent: { actionName: "decrement" },
  });
  screen.render();
  assert.equal(screen.byLabel("奶量滚轮").props.accessibilityValue.now, 120);
  assert.equal(screen.saved(), undefined);
});

test("milk wheel rows grow with Dynamic Type while standard layout remains 44pt", () => {
  const normal = fixture("FinishFeedDialog");
  const large = fixture("FinishFeedDialog", "ios", 2);
  assert.equal(normal.byLabel("奶量滚轮").props.snapToInterval, 44);
  assert.equal(large.byLabel("奶量滚轮").props.snapToInterval, 64);
});

test("Settings native birth date applies only on Done and respects existing date bounds", () => {
  const screen = fixture("NativeDateTimeField");
  screen.byLabel("出生日期 · 可暂不填写").props.onPress();
  screen.render();
  assert.equal(screen.picker().props.mode, "date");
  assert.equal(screen.picker().props.minimumDate.getFullYear(), 1900);
  screen.picker().props.onChange({ type: "set" }, new Date(2026, 9, 1));
  screen.render();
  assert.deepEqual(screen.changed, []);
  assert.equal(screen.picker().props.value.getMonth(), 8);
  screen.action("取消").props.onPress();
  screen.render();
  assert.deepEqual(screen.changed, []);
  screen.byLabel("出生日期 · 可暂不填写").props.onPress();
  screen.render();
  screen.picker().props.onChange({ type: "set" }, new Date(2026, 7, 10));
  screen.render();
  screen.action("完成").props.onPress();
  screen.render();
  assert.deepEqual(screen.changed, ["2026-08-10"]);
  assert.equal(screen.saved(), undefined);
});

test("optional birth date can remain blank and read-only controls cannot alter it", () => {
  const screen = fixture("NativeDateTimeField");
  screen.byLabel("出生日期 · 可暂不填写 · 暂不填写").props.onPress();
  assert.deepEqual(screen.changed, [""]);
  screen.props.editable = false;
  screen.render();
  screen.byLabel("出生日期 · 可暂不填写").props.onPress();
  screen.byLabel("出生日期 · 可暂不填写 · 暂不填写").props.onPress();
  screen.render();
  assert.equal(screen.picker(), undefined);
  assert.deepEqual(screen.changed, [""]);
});

test("daily reminder uses a clock-only reference with no current-time upper bound", () => {
  const screen = fixture("NativeDateTimeField", "ios", 1, {
    label: "每天当地时间 · HH:mm",
    mode: "time",
    value: "02:30",
    optional: false,
    minimumDate: undefined,
    maximumDate: undefined,
  });
  screen.byLabel("每天当地时间 · HH:mm").props.onPress();
  screen.render();
  assert.equal(screen.picker().props.value.getFullYear(), 2000);
  assert.equal(screen.picker().props.value.getHours(), 2);
  assert.equal(screen.picker().props.maximumDate, undefined);
  screen
    .picker()
    .props.onChange({ type: "set" }, new Date(2000, 0, 15, 23, 45));
  screen.render();
  screen.action("完成").props.onPress();
  assert.deepEqual(screen.changed, ["23:45"]);
});

test("Settings Android dismiss does not apply, stale selection cannot bypass read-only changes", () => {
  const screen = fixture("NativeDateTimeField", "android");
  screen.byLabel("出生日期 · 可暂不填写").props.onPress();
  screen.render();
  const dismissed = screen.picker().props.onChange;
  dismissed({ type: "dismissed" }, new Date(2026, 7, 1));
  screen.render();
  assert.deepEqual(screen.changed, []);
  screen.byLabel("出生日期 · 可暂不填写").props.onPress();
  screen.render();
  dismissed({ type: "set" }, new Date(2026, 6, 3));
  assert.deepEqual(screen.changed, []);
  const current = screen.picker().props.onChange;
  screen.props.editable = false;
  screen.render();
  current({ type: "set" }, new Date(2026, 6, 3));
  assert.deepEqual(screen.changed, []);
});

test("Settings web retains the existing labelled validated text input", () => {
  const screen = fixture("NativeDateTimeField", "web");
  const field = screen.nodes().find((node) => node.type === "Field");
  assert.equal(field.props.label, "出生日期 · 可暂不填写");
  assert.equal(field.props.maxLength, 10);
  field.props.onChange("2026-07-10");
  assert.deepEqual(screen.changed, ["2026-07-10"]);
  assert.equal(screen.picker(), undefined);
});
