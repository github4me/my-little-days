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
    f.controls.map((control) => control.props.nativeID),
    ["tab-today", "tab-play", "tab-records", "tab-growth", "tab-settings"],
  );
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
  assert.deepEqual(f.selections, ["settings", "play", "today", "settings"]);
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

test("More composes account and deletion as separate sibling slots using the same controller", () => {
  // Composition boundary only; rendered family-card behavior is covered by the
  // family UI/browser suites. Do not import the live App or its storage/API.
  const source = (filename) =>
    ts.createSourceFile(
      filename,
      fs.readFileSync(filename, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
  const settings = source("src/Settings.tsx");
  const declaration = settings.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "Settings",
  );
  const result = declaration.body.statements.findLast(
    ts.isReturnStatement,
  ).expression;
  const root = ts.isParenthesizedExpression(result)
    ? result.expression
    : result;
  assert(ts.isJsxElement(root));
  const children = root.children.filter(
    (node) => !ts.isJsxText(node) || node.text.trim(),
  );
  const slot = (name) =>
    children.findIndex(
      (node) =>
        ts.isJsxExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === name,
    );
  const accountIndex = slot("accountPanel");
  const deletionIndex = slot("accountDeletionPanel");
  const lastSection = children.findLastIndex(
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(settings) === "SettingsSection",
  );
  assert.ok(accountIndex >= 0);
  assert.ok(deletionIndex > lastSection && deletionIndex > accountIndex);
  assert.equal(
    deletionIndex,
    children.length - 2,
    "Deletion is the final Settings item, before the footer",
  );
  assert.match(
    children.at(-1).getText(settings),
    /No account for offline records/,
  );

  const app = source("App.tsx");
  const elements = [];
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node)) elements.push(node);
    ts.forEachChild(node, visit);
  };
  visit(app);
  const appSettings = elements.find(
    (node) => node.tagName.getText(app) === "Settings",
  );
  const attribute = (element, name) =>
    element.attributes.properties.find(
      (node) => ts.isJsxAttribute(node) && node.name.text === name,
    )?.initializer;
  const account = attribute(appSettings, "accountPanel").expression;
  const deletion = attribute(appSettings, "accountDeletionPanel").expression;
  for (const [panel, section] of [
    [account, "account"],
    [deletion, "deletion"],
  ]) {
    assert(ts.isJsxSelfClosingElement(panel));
    assert.equal(panel.tagName.getText(app), "FamilyScreenView");
    assert.equal(attribute(panel, "section").text, section);
  }
  assert.equal(
    attribute(account, "pilot").expression.getText(app),
    attribute(deletion, "pilot").expression.getText(app),
  );
});

test("Privacy and support is a direct More destination, not an accordion action", () => {
  const settings = fs.readFileSync("src/Settings.tsx", "utf8");
  assert.doesNotMatch(settings, /<SettingsSection title="隐私与支持"/);
  assert.doesNotMatch(settings, /<Button label="隐私与支持"/);
  assert.match(settings, /accessibilityLabel=\{t\("隐私与支持"\)\}/);
  assert.match(settings, /onPress=\{onOpenPrivacy\}/);
});

test("Growth initially shows all measurement series", () => {
  const app = fs.readFileSync("App.tsx", "utf8");
  assert.match(app, /useState<Metric>\("all"\)/);
});
