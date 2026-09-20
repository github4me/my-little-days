import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tick = () => new Promise((resolve) => setImmediate(resolve));
// Exercise the real screen and play-domain code at React Native/storage boundaries.
function fixture(sharedMode = true, display = { width: 390, fontScale: 1 }) {
  let active = "",
    slot = 0,
    nodes = [],
    scheduled = [];
  const values = new Map(),
    refs = new Map(),
    effects = new Map(),
    calls = [];
  const world = {
    sharedMode,
    sharedPlay: {
      selection: { included: ["gentle-touch"], excluded: [] },
      checkins: [],
      canChangeSelection: true,
      canToggleCheckin: () => true,
      onChangeSelection: async (selection) => {
        calls.push({ kind: "shared-selection", selection });
      },
      onToggleCheckin: async (id) => {
        calls.push({ kind: "shared-checkin", id });
      },
    },
  };
  const palette = {
    primary: "blue",
    muted: "gray",
    text: "black",
    line: "gray",
    soft: "white",
    card: "white",
  };
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: {
        ...props,
        ...(children.length
          ? { children: children.length === 1 ? children[0] : children }
          : {}),
      },
    }),
    useContext: () => palette,
    useRef(initial) {
      const key = `${active}:${slot++}`;
      if (!refs.has(key)) refs.set(key, { current: initial });
      return refs.get(key);
    },
    useState(initial) {
      const key = `${active}:${slot++}`;
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
    useEffect(effect, deps) {
      const key = `${active}:${slot++}`,
        old = effects.get(key);
      if (!old || deps.some((dep, index) => !Object.is(dep, old.deps[index])))
        scheduled.push(() => {
          old?.cleanup?.();
          effects.set(key, { deps, cleanup: effect() });
        });
    },
  };
  const modules = new Map();
  const overrides = {
    react,
    "react-native": {
      Modal: "Modal",
      Pressable: "Pressable",
      ScrollView: "ScrollView",
      View: "View",
      useWindowDimensions: () => display,
      Linking: { openURL: async () => {} },
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "react-native-svg": { __esModule: true, default: "Svg", Path: "Path" },
    "./AccessibleModal": { __esModule: true, default: "Modal" },
    "./ui": { Theme: palette, Button: "Button", Card: "Card", T: "T" },
    "./i18n": { useI18n: () => ({ locale: "en-US" }) },
    "./DailyCare": { __esModule: true, default: "DailyCare" },
    "./PlayIcon": { __esModule: true, default: "PlayIcon" },
    "./storage": {
      loadPlaySelection: async () => {
        calls.push({ kind: "personal-load-selection" });
        return { included: ["gentle-touch"], excluded: [] };
      },
      loadPlayCheckins: async () => {
        calls.push({ kind: "personal-load-checkins" });
        return [];
      },
      savePlaySelection: async (selection) =>
        calls.push({ kind: "personal-selection", selection }),
      savePlayCheckins: async (day, ids) =>
        calls.push({ kind: "personal-checkin", day, ids }),
    },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const result = { exports: {} };
    modules.set(file, result);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(code, {
      module: result,
      exports: result.exports,
      Date,
      JSON,
      Number,
      String,
      Map,
      Set,
      require(name) {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (!name.startsWith(".")) throw new Error(`Unexpected ${name}`);
        const dependency = [".ts", ".tsx"]
          .map((extension) =>
            path.resolve(path.dirname(file), name + extension),
          )
          .find(fs.existsSync);
        if (!dependency) throw new Error(`Missing dependency ${name}`);
        return load(dependency);
      },
    });
    return result.exports;
  }
  const Screen = load(path.join(root, "src/PlayLearning.tsx")).default;
  function visit(element, position = "0") {
    if (Array.isArray(element))
      return element.forEach((child, index) =>
        visit(child, `${position}.${index}`),
      );
    if (!element || typeof element !== "object") return;
    if (typeof element.type === "function") {
      const old = [active, slot];
      active = `${position}:${element.type.name}`;
      slot = 0;
      visit(element.type(element.props), `${active}.component`);
      [active, slot] = old;
    } else {
      nodes.push(element);
      if (element.type !== "Modal" || element.props.visible)
        visit(element.props.children, `${position}.children`);
    }
  }
  world.render = () => {
    nodes = [];
    scheduled = [];
    visit(
      react.createElement(Screen, {
        birthDate: "",
        now: Date.parse("2026-09-16T01:00:00Z"),
        careRecords: [],
        onSaveCare: async () => {},
        onDeleteCare: async () => {},
        sharedMode: world.sharedMode,
        sharedPlay: world.sharedPlay,
      }),
    );
    scheduled.forEach((run) => run());
    return nodes;
  };
  world.ready = async () => {
    world.render();
    await tick();
    world.render();
  };
  world.node = (label) =>
    nodes.find((n) => n.props.accessibilityLabel === label);
  const textContent = (value) => {
    if (Array.isArray(value)) return value.map(textContent).join("");
    if (typeof value === "string" || typeof value === "number")
      return String(value);
    return value?.props ? textContent(value.props.children) : "";
  };
  // Only mounted text nodes count; serializing parent props includes children
  // passed into a collapsed component even when it doesn't render them.
  world.visibleText = () =>
    nodes
      .filter((node) => node.type === "T")
      .map((node) => textContent(node.props.children))
      .join("\n");
  world.press = async (label) => {
    const node = world.node(label);
    assert.ok(node, label);
    node.props.onPress();
    await tick();
    world.render();
  };
  world.calls = calls;
  return world;
}

test("daily care is the default Care section", async () => {
  const world = fixture();
  await world.ready();
  assert.equal(
    world.node("Daily care").props.accessibilityState.selected,
    true,
  );
  assert.equal(world.node("Play").props.accessibilityState.selected, false);
  assert.equal(
    world.node("Play settings").props.accessibilityState.selected,
    false,
  );
  assert.ok(world.render().some((node) => node.type === "DailyCare"));
});

test("shared play renders family selections and submits check-ins only to the family callback", async () => {
  const world = fixture();
  await world.ready();
  await world.press("Play");
  const checkin = world.node("Done today: Gentle touch");
  assert.equal(checkin?.props.disabled, false);
  await world.press("Done today: Gentle touch");
  assert.deepEqual(world.calls, [
    { kind: "shared-checkin", id: "gentle-touch" },
  ]);
  world.sharedPlay = { ...world.sharedPlay, checkins: ["gentle-touch"] };
  await world.ready();
  assert.equal(
    world.node("Done today: Gentle touch").props.accessibilityState.checked,
    true,
  );
});
test("member permissions disable owner settings and other members' check-ins, including direct stale handlers", async () => {
  const world = fixture();
  world.sharedPlay.canChangeSelection = false;
  world.sharedPlay.canToggleCheckin = () => false;
  world.sharedPlay.checkins = ["gentle-touch"];
  await world.ready();
  await world.press("Play");
  const checkin = world.node("Done today: Gentle touch"),
    selection = world.node("Select play activity: Gentle touch");
  assert.equal(checkin?.props.disabled, true);
  assert.equal(selection?.props.disabled, true);
  checkin.props.onPress();
  selection.props.onPress();
  await tick();
  assert.deepEqual(world.calls, []);
});
test("owner selection updates use the family callback without writing personal settings", async () => {
  const world = fixture();
  await world.ready();
  await world.press("Play");
  await world.press("Select play activity: Gentle touch");
  assert.deepEqual(JSON.parse(JSON.stringify(world.calls)), [
    {
      kind: "shared-selection",
      selection: { included: [], excluded: ["gentle-touch"] },
    },
  ]);
});
test("legacy shared server disables edits and never reads the personal play store", async () => {
  const world = fixture();
  world.sharedPlay = undefined;
  await world.ready();
  await world.press("Play settings");
  assert.equal(
    world.node("Select play activity: Gentle touch")?.props.disabled,
    true,
  );
  assert.deepEqual(world.calls, []);
});
test("offline check-ins retain their existing personal persistence behavior", async () => {
  const world = fixture(false);
  await world.ready();
  await world.press("Play");
  await world.press("Done today: Gentle touch");
  assert.equal(
    world.calls.filter((c) => c.kind === "personal-checkin").length,
    1,
  );
  assert.equal(
    world.calls.filter((c) => c.kind.startsWith("shared")).length,
    0,
  );
});

test("play storage disclosure reflects the active family or personal workspace", async () => {
  for (const shared of [false, true]) {
    const world = fixture(shared);
    await world.ready();
    await world.press("Play");
    await world.press("Play help & references");
    const contents = world.visibleText();
    assert.equal(
      contents.includes("Play settings and dated check-ins stay locally"),
      !shared,
    );
    assert.equal(
      contents.includes(
        "Family play settings and check-ins depend on confirmed synchronization",
      ),
      shared,
    );
  }
});

test("play help starts collapsed and retains the mode-specific intro and references", async () => {
  const world = fixture();
  await world.ready();
  await world.press("Play");
  const help = world.node("Play help & references");
  assert.equal(help.props.accessibilityState.expanded, false);
  assert.equal(help.props["aria-expanded"], false);
  assert.ok(help.props.style({ pressed: false }).minHeight >= 44);
  assert.ok(!world.visibleText().includes("Parent-led play activities"));
  assert.ok(
    !world.visibleText().includes("Activities are editorial adaptations"),
  );
  await world.press("Play help & references");
  assert.equal(
    world.node("Play help & references").props["aria-expanded"],
    true,
  );
  assert.ok(world.visibleText().includes("A little play in everyday moments"));
  assert.ok(world.visibleText().includes("Parent-led play activities"));
  assert.ok(
    world.visibleText().includes("Activities are editorial adaptations"),
  );
  assert.ok(
    world.visibleText().includes("Why put the screen away? WHO reference"),
  );
  await world.press("Play help & references");
  await world.press("Play settings");
  assert.ok(!world.visibleText().includes("Choose the play that suits you"));
  await world.press("Play help & references");
  assert.ok(world.visibleText().includes("Choose the play that suits you"));
  assert.ok(
    world.visibleText().includes("Browse by age and choose activities"),
  );
  assert.deepEqual(world.calls, []);
});

test("sharing explanation is collapsed below content while capability and safety notices stay visible", async () => {
  const world = fixture();
  await world.ready();
  await world.press("Play");
  assert.ok(
    !world
      .visibleText()
      .includes("Play settings and check-ins are shared with your family"),
  );
  assert.equal(
    world.node("Family sharing help & references").props["aria-expanded"],
    false,
  );
  const nodes = world.render();
  assert.ok(
    nodes.indexOf(world.node("Daily care")) < nodes.indexOf(world.node("Play")),
  );
  assert.ok(
    nodes.indexOf(world.node("Play")) <
      nodes.indexOf(world.node("Play settings")),
  );
  assert.ok(
    nodes.indexOf(world.node("Family sharing help & references")) >
      nodes.indexOf(world.node("Play help & references")),
  );
  await world.press("Family sharing help & references");
  assert.ok(
    world
      .visibleText()
      .includes("Play settings and check-ins are shared with your family"),
  );
  await world.press("View Gentle touch");
  assert.ok(world.visibleText().includes("Keep it safe:"));
  assert.equal(
    world.node("Play help & references").props["aria-expanded"],
    false,
  );
  world.sharedPlay = undefined;
  await world.ready();
  assert.ok(
    world
      .visibleText()
      .includes(
        "This server does not yet support shared play settings or check-ins",
      ),
  );
  assert.deepEqual(world.calls, []);
});

test("large-text play section controls reflow without reducing label size", async () => {
  const world = fixture(true, { width: 390, fontScale: 2 });
  await world.ready();
  for (const label of ["Daily care", "Play", "Play settings"]) {
    const option = world.node(label);
    assert.equal(option.props.style.flexBasis, "100%");
    assert.ok(
      option.props.style.minWidth >= 44 && option.props.style.minHeight >= 44,
    );
  }
});
