import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Native props and event contracts; physical reading/focus still need iOS checks.
function fixture(file, props, { fontScale = 1, failMail = false } = {}) {
  const state = [],
    cache = new Map();
  let slot = 0,
    nodes = [];
  const palette = {
    isDark: false,
    text: "#29475E",
    muted: "#60798D",
    primary: "#34759D",
    card: "#FFFFFF",
    bg: "#F4F9FD",
  };
  const react = {
    Fragment: "Fragment",
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    useContext: () => palette,
    useState(initial) {
      const key = slot++;
      if (!(key in state))
        state[key] = typeof initial === "function" ? initial() : initial;
      return [
        state[key],
        (value) => {
          state[key] = typeof value === "function" ? value(state[key]) : value;
        },
      ];
    },
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.React,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }).outputText,
      {
        module,
        exports: module.exports,
        Date,
        Number,
        String,
        Map,
        Set,
        require(name) {
          if (name === "react") return react;
          if (name === "react-native")
            return {
              View: "View",
              Pressable: "Pressable",
              ScrollView: "ScrollView",
              useWindowDimensions: () => ({ width: 390, fontScale }),
              Linking: {
                openURL: async () => {
                  if (failMail) throw new Error("No mail app");
                },
              },
            };
          if (name === "react-native-svg")
            return {
              __esModule: true,
              default: "Svg",
              Path: "Path",
              Line: "Line",
              Rect: "Rect",
              Circle: "Circle",
              Text: "SvgText",
            };
          if (name === "./ui")
            return {
              Theme: {},
              T: "T",
              Card: "Card",
              Chips: "Chips",
              row: { flexDirection: "row" },
              heading: {},
            };
          if (name === "./i18n")
            return {
              t: (text, args) =>
                text.replace(/\{(\w+)\}/g, (_, key) => args?.[key] ?? ""),
              useI18n: () => ({ locale: "en-US" }),
              formatDate: (value) => new Date(value).toISOString().slice(0, 10),
              formatTime: () => "09:00",
              elapsed: () => "10m",
            };
          if (name === "./growth")
            return {
              referenceSeries: () => [
                { months: 0, p3: 3, p15: 4, p50: 5, p85: 6, p97: 7 },
              ],
            };
          if (name === "./domain")
            return {
              summarize: () => ({
                feedMl: 60,
                sleepMinutes: 0,
                diaperCount: 0,
                wetCount: 0,
                dirtyCount: 0,
              }),
            };
          if (name === "./RecordsCalendar") return "RecordsCalendar";
          if (name === "./recordRange") return load("src/recordRange.ts");
          throw new Error(`Unexpected dependency ${name}`);
        },
      },
    );
    cache.set(filename, module.exports);
    return module.exports;
  }
  const Screen = load(file).default;
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
  render();
  return { render, nodes: () => nodes };
}

test("record actions have 44-point targets and announced readonly state; notes stay complete", () => {
  const note =
    "A long note remains fully readable rather than being cut off after one line.";
  const screen = fixture(
    "src/Records.tsx",
    {
      view: "bars",
      entries: [
        {
          id: "feed",
          type: "feed",
          start: new Date(2026, 8, 18, 9).toISOString(),
          amount: 60,
          note,
        },
      ],
      now: new Date(2026, 8, 18, 12).getTime(),
      onEdit() {},
      onDelete() {},
      canEdit: () => false,
    },
    { fontScale: 2 },
  );
  for (const label of ["编辑喂奶", "删除喂奶"]) {
    const button = screen
      .nodes()
      .find((node) => node.props.accessibilityLabel === label);
    assert.ok(button);
    assert.equal(button.props.disabled, true);
    assert.equal(button.props.accessibilityState.disabled, true);
    assert.ok(
      button.props.style.minWidth >= 44 && button.props.style.minHeight >= 44,
    );
  }
  const noteNode = screen
    .nodes()
    .find((node) => node.type === "T" && node.props.children.includes(note));
  assert.equal(noteNode.props.numberOfLines, undefined);
  assert.equal(noteNode.props.raw, true);
  assert.equal(
    screen
      .nodes()
      .some(
        (node) => node.type === "ScrollView" && node.props.horizontal === false,
      ),
    true,
  );
});

test("privacy is readable and a failed mail handoff gives recoverable feedback", async () => {
  const screen = fixture(
    "src/PrivacySupport.tsx",
    { onBack() {} },
    { failMail: true },
  );
  const back = screen
    .nodes()
    .find((node) => node.props.accessibilityLabel === "返回我的");
  assert.ok(back.props.style({ pressed: false })[0].minHeight >= 44);
  assert.ok(
    screen
      .nodes()
      .some(
        (node) =>
          node.props.accessibilityRole === "header" &&
          node.props.children.includes("隐私与支持"),
      ),
  );
  const contact = screen
    .nodes()
    .find((node) => node.props.accessibilityLabel === "联系支持");
  contact.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  screen.render();
  assert.ok(
    screen
      .nodes()
      .some(
        (node) =>
          node.props.accessibilityRole === "alert" &&
          JSON.stringify(node.props.children).includes(
            "Could not open your email app",
          ),
      ),
  );
  assert.ok(
    screen
      .nodes()
      .some(
        (node) =>
          node.props.selectable === true &&
          node.props.children.includes("contact@reticle.com.au"),
      ),
  );
});

test("growth chart exposes a bounded count/latest summary instead of reading every point", () => {
  const entries = Array.from({ length: 120 }, (_, index) => ({
    id: `g-${index}`,
    type: "growth",
    start: new Date(2026, 4, 1 + index).toISOString(),
    weight: index === 119 ? 9.2 : 6,
    note: "",
  }));
  const screen = fixture("src/GrowthChart.tsx", {
    entries,
    profile: { birthDate: "2026-04-01", sex: "male" },
    metric: "weight",
  });
  const graph = screen.nodes().find((node) => node.type === "Svg");
  assert.equal(graph.props.accessible, true);
  assert.equal(graph.props.accessibilityRole, "image");
  assert.match(graph.props.accessibilityLabel, /120 recorded measurements/);
  assert.match(graph.props.accessibilityLabel, /Latest: 9\.2 kg/);
  assert.ok(graph.props.accessibilityLabel.length < 300);
  assert.ok(
    screen
      .nodes()
      .filter((node) => node.type === "SvgText")
      .every((node) => node.props.fontSize >= 11),
  );
});

test("reference-only growth plots do not announce reference values as baby measurements", () => {
  const screen = fixture("src/GrowthChart.tsx", {
    entries: [],
    profile: { birthDate: "2026-04-01", sex: "female" },
    metric: "length",
  });
  const graph = screen.nodes().find((node) => node.type === "Svg");
  assert.match(
    graph.props.accessibilityLabel,
    /No recorded measurements; only reference curves/,
  );
  assert.doesNotMatch(graph.props.accessibilityLabel, /Latest/);
});

test("latest growth summary chooses the actual time when several readings share a day", () => {
  const screen = fixture("src/GrowthChart.tsx", {
    entries: [
      {
        id: "latest",
        type: "growth",
        start: "2026-09-18T10:00:00Z",
        weight: 9.2,
      },
      {
        id: "earlier",
        type: "growth",
        start: "2026-09-18T09:00:00Z",
        weight: 9.1,
      },
    ],
    profile: { birthDate: "2026-04-01", sex: "male" },
    metric: "weight",
  });
  assert.match(
    screen.nodes().find((node) => node.type === "Svg").props.accessibilityLabel,
    /Latest: 9\.2 kg/,
  );
});
