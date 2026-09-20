import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Exercise the real care screen's event/state wiring at the native boundary.
// This does not claim to render native wheels or test iOS layout/VoiceOver.
function fixture(platform = "ios", overrides = {}) {
  const states = [],
    refs = [],
    callbacks = [],
    cache = new Map();
  let slot = 0,
    nodes = [],
    keyboardDismissals = 0;
  const now = new Date(2026, 8, 18, 10, 4, 37).getTime();
  const props = {
    records: [],
    birthDate: "2026-07-01",
    now,
    onSave: async () => {},
    onDelete: async () => {},
    ...overrides,
  };
  const palette = {
    isDark: true,
    input: "#123",
    elevated: "#234",
    controlLine: "#abc",
  };
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    useContext: () => palette,
    useState(initial) {
      const key = slot++;
      if (!(key in states)) states[key] = initial;
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
      const key = slot++;
      const previous = callbacks[key];
      if (
        !previous ||
        dependencies.some(
          (value, index) => !Object.is(value, previous.dependencies[index]),
        )
      ) {
        callbacks[key] = { callback, dependencies };
      }
      return callbacks[key].callback;
    },
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
      require(name) {
        if (name === "react") return react;
        if (name === "react-native-svg")
          return { __esModule: true, default: "Svg", Path: "Path" };
        if (name === "react-native")
          return {
            ...Object.fromEntries(
              ["Modal", "Pressable", "View"].map((name) => [name, name]),
            ),
            Platform: { OS: platform },
            Linking: {},
            Keyboard: { dismiss: () => keyboardDismissals++ },
            useWindowDimensions: () => ({
              width: 390,
              height: 844,
              fontScale: 1,
            }),
          };
        if (name === "./AccessibleModal") return "Modal";
        if (name === "./HelpDisclosure") return "HelpDisclosure";
        if (name === "react-native-safe-area-context")
          return { SafeAreaView: "SafeAreaView" };
        if (name === "@react-native-community/datetimepicker")
          return "DateTimePicker";
        if (name === "./ui")
          return {
            Theme: {},
            dark: palette,
            ...Object.fromEntries(
              ["Button", "Card", "Field", "T"].map((name) => [name, name]),
            ),
          };
        if (name === "./i18n") return { useI18n: () => ({ locale: "en-US" }) };
        if (name === "./domain")
          return {
            makeId: () => "care-new",
            validateCareRecord: (record) => record,
          };
        if (name === "./PlayIcon") return "PlayIcon";
        if (name === "./learning")
          return {
            words: (zh, en) => ({ zh, en }),
            playDayKey: (value) =>
              `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`,
          };
        const base = path.resolve(path.dirname(filename), name);
        return load([base + ".ts", base + ".tsx"].find(fs.existsSync));
      },
    });
    cache.set(filename, module.exports);
    return module.exports;
  }
  const Screen = load(path.resolve("src/DailyCare.tsx")).default;
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (typeof node.type === "function") return walk(node.type(node.props));
    nodes.push(node);
    walk(node.props.children);
  }
  function render() {
    slot = 0;
    nodes = [];
    walk(Screen(props));
  }
  function content(node) {
    if (Array.isArray(node)) return node.map(content).join("");
    if (typeof node === "string") return node;
    return node?.props ? content(node.props.children) : "";
  }
  render();
  return {
    render,
    props,
    picker: () => nodes.find((node) => node.type === "DateTimePicker"),
    field: (label) =>
      nodes.find((node) => node.type === "Field" && node.props.label === label),
    control: (label) =>
      nodes.find(
        (node) =>
          node.type === "Pressable" && node.props.accessibilityLabel === label,
      ),
    action: (label) =>
      nodes.find(
        (node) => node.type === "Pressable" && content(node) === label,
      ),
    save: () =>
      nodes.find(
        (node) =>
          node.type === "Button" && node.props.label === "Save care record",
      ),
    keyboardDismissals: () => keyboardDismissals,
  };
}

test("every care category opens themed native wheels without saving the draft", () => {
  const screen = fixture();
  for (const kind of [
    "Temp",
    "Bath",
    "Wash",
    "Teeth",
    "Nails",
    "Supplements",
  ]) {
    screen.control(kind).props.onPress();
    screen.render();
    screen.control("Care time").props.onPress();
    screen.render();
    assert.equal(screen.picker().props.mode, "time");
    assert.equal(screen.picker().props.display, "spinner");
    assert.equal(screen.picker().props.themeVariant, "dark");
    screen
      .picker()
      .props.onChange({ type: "set" }, new Date(2026, 8, 18, 9, 15));
    screen.render();
    assert.equal(
      screen.control("Care time").props.accessibilityValue.text,
      "10:04",
    );
    screen.action("Cancel").props.onPress();
    screen.render();
    assert.equal(screen.picker(), undefined);
    assert.equal(
      screen.control("Care time").props.accessibilityValue.text,
      "10:04",
    );
  }
  assert.equal(screen.keyboardDismissals(), 6);
});

test("supplements support multiple explicit choices, custom text and editing", async () => {
  let saved;
  const screen = fixture("ios", {
    onSave: async (record) => {
      saved = record;
    },
  });
  screen.control("Supplements").props.onPress();
  screen.render();
  for (const label of ["Vitamin D (VD)", "Probiotics", "Other"]) {
    assert.equal(screen.control(label).props.accessibilityState.checked, false);
    assert.equal(screen.control(label).props["aria-checked"], false);
    screen.control(label).props.onPress();
    screen.render();
    assert.equal(screen.control(label).props.accessibilityState.checked, true);
    assert.equal(screen.control(label).props["aria-checked"], true);
  }
  screen.field("Other supplement name").props.onChange("Prescribed product");
  screen.render();
  screen.save().props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saved.kind, "supplement");
  assert.deepEqual(
    [...saved.supplements],
    ["vitamin-d", "probiotics", "other"],
  );
  assert.equal(saved.otherSupplement, "Prescribed product");
  screen.props.records = [saved];
  screen.render();
  screen.control("Edit care record").props.onPress();
  screen.render();
  assert.equal(
    screen.field("Other supplement name").props.value,
    "Prescribed product",
  );
  assert.equal(
    screen.control("Probiotics").props.accessibilityState.checked,
    true,
  );
  const olderService = fixture("ios", { sharedMode: true });
  olderService.control("Supplements").props.onPress();
  olderService.render();
  assert.equal(olderService.save().props.disabled, true);
});

test("Done commits the draft while reopening after cancellation uses the unchanged time", () => {
  const screen = fixture();
  screen.control("Care time").props.onPress();
  screen.render();
  screen.picker().props.onChange({ type: "set" }, new Date(2026, 8, 18, 9, 15));
  screen.render();
  screen.action("Cancel").props.onPress();
  screen.render();
  screen.control("Care time").props.onPress();
  screen.render();
  assert.equal(screen.picker().props.value.getHours(), 10);
  assert.equal(screen.picker().props.value.getMinutes(), 4);
  screen.picker().props.onChange({ type: "set" }, new Date(2026, 8, 18, 9, 20));
  screen.render();
  screen.action("Done").props.onPress();
  screen.render();
  assert.equal(screen.picker(), undefined);
  assert.equal(
    screen.control("Care time").props.accessibilityValue.text,
    "09:20",
  );
});

test("Android dismiss ignores its date value, and set commits with current-minute limits", () => {
  const screen = fixture("android");
  screen.control("Care time").props.onPress();
  screen.render();
  screen
    .picker()
    .props.onChange({ type: "dismissed" }, new Date(2026, 8, 18, 9, 15));
  screen.render();
  assert.equal(screen.picker(), undefined);
  assert.equal(
    screen.control("Care time").props.accessibilityValue.text,
    "10:04",
  );
  screen.control("Care time").props.onPress();
  screen.render();
  screen
    .picker()
    .props.onChange({ type: "set" }, new Date(2026, 8, 18, 14, 30));
  screen.render();
  assert.equal(screen.picker(), undefined);
  assert.equal(
    screen.control("Care time").props.accessibilityValue.text,
    "10:04",
  );
});

test("editing preserves the historical day and category changes reset the picker", () => {
  const screen = fixture("ios", {
    records: [
      {
        id: "old-temp",
        kind: "temperature",
        time: new Date(2026, 7, 12, 9, 15).toISOString(),
        temperature: 36.8,
        method: "armpit",
        note: "",
      },
    ],
  });
  screen.control("Edit care record").props.onPress();
  screen.render();
  screen.control("Care time").props.onPress();
  screen.render();
  screen
    .picker()
    .props.onChange({ type: "set" }, new Date(2026, 8, 18, 14, 30));
  screen.render();
  screen.action("Done").props.onPress();
  screen.render();
  assert.equal(
    screen.control("Care date").props.accessibilityValue.text,
    "2026-08-12",
  );
  assert.equal(
    screen.control("Care time").props.accessibilityValue.text,
    "14:30",
  );
  screen.control("Care date").props.onPress();
  screen.render();
  screen.control("Bath").props.onPress();
  screen.render();
  assert.equal(screen.picker(), undefined);
  assert.equal(
    screen.control("Care date").props.accessibilityValue.text,
    "2026-09-18",
  );
  assert.equal(
    screen.control("Care time").props.accessibilityValue.text,
    "10:04",
  );
});

test("web retains labelled editable fields and validation input rather than native wheels", () => {
  const screen = fixture("web");
  screen.field("Care date").props.onChange("2026-08-12");
  screen.field("Care time").props.onChange("09:15");
  screen.render();
  assert.equal(screen.field("Care date").props.value, "2026-08-12");
  assert.equal(screen.field("Care time").props.value, "09:15");
  assert.equal(screen.control("Care time"), undefined);
  assert.equal(screen.picker(), undefined);
});

test("app clock ticks do not reopen Android's dialog and confirmation uses current bounds", () => {
  const screen = fixture("android");
  screen.control("Care time").props.onPress();
  screen.render();
  const onChange = screen.picker().props.onChange;
  const openedAt = screen.picker().props.value.getTime();
  screen.props.now = new Date(2026, 8, 18, 10, 5, 1).getTime();
  screen.render();
  assert.equal(screen.picker().props.onChange, onChange);
  assert.equal(screen.picker().props.value.getTime(), openedAt);
  onChange({ type: "set" }, new Date(2026, 8, 18, 10, 5));
  screen.render();
  assert.equal(
    screen.control("Care time").props.accessibilityValue.text,
    "10:05",
  );
});

test("confirmation rechecks a changed birth boundary while a date draft is open", () => {
  const screen = fixture();
  screen.control("Care date").props.onPress();
  screen.render();
  screen.picker().props.onChange({ type: "set" }, new Date(2026, 7, 12));
  screen.render();
  screen.props.birthDate = "2026-09-10";
  screen.render();
  assert.equal(
    screen.picker().props.value.getTime(),
    new Date(2026, 8, 10).getTime(),
  );
  screen.action("Done").props.onPress();
  screen.render();
  assert.equal(
    screen.control("Care date").props.accessibilityValue.text,
    "2026-09-10",
  );
});
