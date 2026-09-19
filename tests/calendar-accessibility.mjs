import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Native-boundary contract only; no claim of rendered iOS layout.
function fixture({ fontScale = 1, isDark = false } = {}) {
  const state = [],
    refs = [],
    cache = new Map();
  let slot = 0,
    nodes = [];
  const today = new Date(2026, 8, 18, 12);
  const entries = Array.from({ length: 7 }, (_, index) => ({
    id: `today-${index}`,
    type: index === 6 ? "sleep" : "feed",
    start: new Date(2026, 8, 18, 1 + index).toISOString(),
    end: new Date(2026, 8, 18, 1 + index, 30).toISOString(),
    amount: 60,
    note: "",
  }));
  entries.push({
    id: "yesterday",
    type: "sleep",
    start: new Date(2026, 8, 17, 9).toISOString(),
    end: new Date(2026, 8, 17, 10).toISOString(),
    note: "",
  });
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    useContext: () => ({ isDark }),
    useState(initial) {
      const key = slot++;
      if (!(key in state)) state[key] = initial;
      return [
        state[key],
        (value) => {
          state[key] = typeof value === "function" ? value(state[key]) : value;
        },
      ];
    },
    useRef(initial) {
      const key = slot++;
      return (refs[key] ??= { current: initial });
    },
  };
  const t = (text, args) =>
    text.replace(/\{(\w+)\}/g, (_, key) => args?.[key] ?? "");
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
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
      Map,
      require(name) {
        if (name === "react") return react;
        if (name === "react-native")
          return {
            Platform: { OS: "ios" },
            Pressable: "Pressable",
            ScrollView: "ScrollView",
            TextInput: "TextInput",
            View: "View",
            useWindowDimensions: () => ({ width: 390, fontScale }),
          };
        if (name === "react-native-safe-area-context")
          return { SafeAreaView: "SafeAreaView" };
        if (name === "@react-native-community/datetimepicker")
          return "DateTimePicker";
        if (name === "react-native-svg")
          return {
            __esModule: true,
            default: "Svg",
            Path: "Path",
            Rect: "Rect",
          };
        if (name === "./AccessibleModal") return "Modal";
        if (name === "./CareIcon") return "CareIcon";
        if (name === "./RecordActionButton")
          return load("src/RecordActionButton.tsx");
        if (name === "./ui")
          return { Theme: {}, Button: "Button", Card: "Card", T: "T", row: {} };
        if (name === "./domain")
          return {
            summarize: () => ({
              feedMl: 360,
              diaperCount: 0,
              sleepMinutes: 30,
            }),
          };
        if (name === "./i18n")
          return {
            t,
            elapsed: () => "30m",
            formatDate: () => "18 Sep",
            formatTime: (value) => new Date(value).toTimeString().slice(0, 5),
            useI18n: () => ({ locale: "en-US" }),
          };
        if (name === "./recordCalendar") return load("src/recordCalendar.ts");
        throw new Error(`Unexpected dependency: ${name}`);
      },
    });
    cache.set(file, module.exports);
    return module.exports;
  }
  const Screen = load("src/RecordsCalendar.tsx").default;
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    if (node.type !== "Modal" || node.props.visible) walk(node.props.children);
  }
  function render() {
    slot = 0;
    nodes = [];
    walk(Screen({ entries, now: today.getTime(), onEdit() {}, onDelete() {} }));
  }
  render();
  return {
    render,
    nodes: () => nodes,
    press(label) {
      const control = nodes.find(
        (node) => node.props.accessibilityLabel === label,
      );
      assert.ok(control, label);
      control.props.onPress();
      render();
    },
    list: () =>
      nodes.filter((node) =>
        node.props.accessibilityLabel?.startsWith("打开日历记录："),
      ),
    chart: () =>
      nodes.filter((node) =>
        node.props.accessibilityLabel?.startsWith("查看记录："),
      ),
  };
}

test("larger reading sizes replace truncated timeline labels with every full record row", () => {
  const regular = fixture();
  assert.equal(regular.chart().length, 7);
  assert.equal(regular.list().length, 5);
  for (const fontScale of [1.3, 2, 3]) {
    const large = fixture({ fontScale });
    assert.equal(large.chart().length, 0);
    assert.equal(large.list().length, 7);
    assert.equal(new Set(large.list().map((node) => node.props.key)).size, 7);
    assert.ok(large.list().every((node) => node.props.style.minHeight >= 44));
  }
});

test("accessible calendar list preserves selected date and type filters", () => {
  const screen = fixture({ fontScale: 2 });
  screen.press("筛选记录：全部");
  screen.press("筛选：睡眠");
  assert.equal(screen.list().length, 1);
  assert.equal(screen.list()[0].props.key, "today-6");
  screen.press("前一天");
  assert.equal(screen.list().length, 1);
  assert.equal(screen.list()[0].props.key, "yesterday");
  screen.press("回到今天");
  assert.equal(screen.list().length, 1);
  assert.equal(screen.list()[0].props.key, "today-6");
});

test("calendar record details use icon actions with descriptive accessibility", () => {
  const screen = fixture();
  screen.chart()[0].props.onPress();
  screen.render();
  for (const [label, action, hint] of [
    ["编辑记录", "edit", "打开记录编辑界面"],
    ["删除记录", "delete", "打开删除确认"],
  ]) {
    const control = screen
      .nodes()
      .find((node) => node.props.accessibilityLabel === label);
    assert.ok(control, label);
    assert.equal(control.props.action, action);
    assert.equal(control.props.accessibilityHint, hint);
  }
  assert.equal(
    screen
      .nodes()
      .filter(
        (node) =>
          node.type === "Button" &&
          ["编辑记录", "删除记录"].includes(node.props.label),
      ).length,
    0,
  );
});

test("native date picker derives its appearance from the semantic theme", () => {
  for (const isDark of [false, true]) {
    const screen = fixture({ isDark });
    screen.press("选择日历日期");
    const picker = screen
      .nodes()
      .find((node) => node.type === "DateTimePicker");
    assert.equal(picker.props.themeVariant, isDark ? "dark" : "light");
    assert.equal(picker.props.mode, "date");
    picker.props.onChange({ type: "dismissed" }, new Date(2026, 8, 17));
    screen.render();
    assert.equal(screen.list()[0].props.key.startsWith("today-"), true);
  }
});
