import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Test route and control wiring, not native VoiceOver or Large Content Viewer.
function fixture(platform = "ios") {
  const announcements = [];
  const selections = [];
  const ref = {};
  let focusedInput = null;
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    useRef: (value) => {
      if (!("current" in ref)) ref.current = value;
      return ref;
    },
    useEffect: (effect) => effect(),
  };
  const native = {
    Platform: { OS: platform },
    AccessibilityInfo: {
      announceForAccessibility: (title) => announcements.push(title),
    },
    TextInput: { State: { currentlyFocusedInput: () => focusedInput } },
    Pressable: "Pressable",
    View: "View",
  };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/AppNavigation.tsx", "utf8"), {
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
      require(name) {
        if (name === "react") return react;
        if (name === "react-native") return native;
        if (name === "react-native-svg")
          return { default: "Svg", Path: "Path" };
        if (name === "./ui") return { T: "T" };
        if (name === "./i18n") return { t: (value) => `localized:${value}` };
        throw new Error(name);
      },
    },
  );
  const api = module.exports;
  const nodes = [];
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    walk(node.props.children);
  }
  walk(
    api.AppTabBar({
      tab: "today",
      colors: { primary: "blue", muted: "gray" },
      onSelect: (value) => selections.push(value),
    }),
  );
  return {
    announce: api.useNavigationAnnouncement,
    announcements,
    selections,
    controls: nodes.filter((node) => node.type === "Pressable"),
    labels: nodes.filter((node) => node.type === "T"),
    setFocusedInput: (input) => {
      focusedInput = input;
    },
  };
}

test("native route announcement ignores initial load and same-page updates", () => {
  const f = fixture();
  f.announce("today", "Today", false);
  f.announce("today", "Today", false);
  assert.deepEqual(f.announcements, []);
  f.announce("records", "Records", false);
  f.announce("records", "Records", false);
  assert.deepEqual(f.announcements, ["Records"]);
});

test("navigation never interrupts an active sheet or field, including delayed closing", () => {
  const f = fixture();
  f.announce("today", "Today", false);
  f.announce("settings/main", "More", true);
  f.announce("settings/main", "More", false);
  assert.deepEqual(f.announcements, []);
  f.setFocusedInput({});
  f.announce("settings/family", "Family sharing", false);
  f.setFocusedInput(null);
  f.announce("settings/family", "Family sharing", false);
  assert.deepEqual(f.announcements, []);
  f.announce("settings/main", "More", false);
  assert.deepEqual(f.announcements, ["More"]);
});

test("all five tabs retain labels, selected states, comfortable targets and iOS large content titles", () => {
  const f = fixture();
  assert.equal(f.controls.length, 5);
  assert.deepEqual(
    f.controls.map((node) => node.props.accessibilityState.selected),
    [true, false, false, false, false],
  );
  for (const control of f.controls) {
    assert.equal(control.props.accessibilityRole, "tab");
    assert.equal(control.props.accessibilityShowsLargeContentViewer, true);
    assert.equal(
      control.props.accessibilityLargeContentTitle,
      control.props.accessibilityLabel,
    );
    assert.ok(control.props.style({ pressed: false }).minHeight >= 44);
  }
  assert.ok(
    f.labels.every((label) => label.props.maxFontSizeMultiplier === 1.3),
  );
});

test("web uses roving keyboard focus; Android and web labels are not capped", () => {
  const f = fixture("web");
  const focused = [];
  const controls = f.controls.map((_, index) => ({
    focus: () => focused.push(index),
  }));
  let prevented = 0;
  const event = (key) => ({
    key,
    preventDefault: () => prevented++,
    currentTarget: { closest: () => ({ querySelectorAll: () => controls }) },
  });
  assert.deepEqual(
    f.controls.map((node) => node.props.tabIndex),
    [0, -1, -1, -1, -1],
  );
  f.controls[0].props.onKeyDown(event("ArrowLeft"));
  f.controls[0].props.onKeyDown(event("ArrowRight"));
  f.controls[2].props.onKeyDown(event("Home"));
  f.controls[2].props.onKeyDown(event("End"));
  f.controls[2].props.onKeyDown(event("x"));
  assert.deepEqual(f.selections, ["settings", "records", "today", "settings"]);
  assert.deepEqual(focused, [4, 1, 0, 4]);
  assert.equal(prevented, 4);
  f.announce("today", "Today", false);
  f.announce("records", "Records", false);
  assert.deepEqual(f.announcements, []);
  assert.ok(
    f.labels.every((label) => label.props.maxFontSizeMultiplier === undefined),
  );
  assert.ok(
    fixture("android").labels.every(
      (label) => label.props.maxFontSizeMultiplier === undefined,
    ),
  );
});
