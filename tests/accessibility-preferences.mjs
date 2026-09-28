import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture(platform = "ios", initial = {}) {
  let state,
    effect,
    cleanup,
    media = new Map();
  const events = new Map();
  const values = {
    motion: false,
    contrast: false,
    bold: false,
    transparency: false,
    crossFade: false,
    ...initial,
  };
  const calls = [];
  const react = {
    createContext: (value) => ({ Provider: "Provider", value }),
    useContext: (context) => context.value,
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    useState: (value) => {
      state ??= value;
      return [
        state,
        (update) => {
          state = typeof update === "function" ? update(state) : update;
        },
      ];
    },
    useEffect: (run) => {
      effect = run;
    },
  };
  const read = (key) => () => {
    calls.push(key);
    return Promise.resolve(values[key]);
  };
  const native = {
    Platform: { OS: platform },
    Modal: "Modal",
    View: "View",
    AccessibilityInfo: {
      isReduceMotionEnabled: read("motion"),
      prefersCrossFadeTransitions: read("crossFade"),
      isDarkerSystemColorsEnabled: read("contrast"),
      isHighTextContrastEnabled: read("contrast"),
      isBoldTextEnabled: read("bold"),
      isReduceTransparencyEnabled: read("transparency"),
      addEventListener: (name, listener) => {
        events.set(name, listener);
        return { remove: () => events.delete(name) };
      },
    },
    AppState: {
      addEventListener: (name, listener) => {
        events.set("appstate", listener);
        return { remove: () => events.delete("appstate") };
      },
    },
  };
  function load(file, overrides = {}) {
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
      Promise,
      window: {
        matchMedia(query) {
          const entry = {
            matches: false,
            addEventListener: (_, listener) => {
              entry.listener = listener;
            },
            removeEventListener: () => {
              entry.listener = null;
            },
          };
          media.set(query, entry);
          return entry;
        },
      },
      require(name) {
        if (name in overrides) return overrides[name];
        if (name === "react") return react;
        if (name === "react-native") return native;
        throw new Error(`Unexpected dependency ${name}`);
      },
    });
    return module.exports;
  }
  const prefs = load("src/accessibilityPreferences.tsx");
  return {
    values,
    events,
    calls,
    media,
    load,
    mount() {
      prefs.AccessibilityPreferencesProvider({ children: "app" });
      cleanup = effect();
    },
    unmount() {
      cleanup();
    },
    get state() {
      return state;
    },
  };
}

test("OS preferences are read without blocking the first frame and update live", async () => {
  const world = fixture("ios", {
    contrast: true,
    bold: true,
    transparency: true,
  });
  world.mount();
  assert.equal(world.state.reduceMotion, true);
  await tick();
  assert.equal(world.state.highContrast, true);
  assert.equal(world.state.boldText, true);
  assert.equal(world.state.reduceTransparency, true);
  assert.equal(world.state.reduceMotion, false);
  world.events.get("darkerSystemColorsChanged")(false);
  assert.equal(world.state.highContrast, false);
  world.unmount();
  assert.equal(world.events.size, 0);
});

test("late initial queries cannot overwrite a newer preference event or unmounted tree", async () => {
  let resolve;
  const world = fixture("ios", {
    contrast: new Promise((done) => {
      resolve = done;
    }),
  });
  world.mount();
  world.events.get("darkerSystemColorsChanged")(true);
  resolve(false);
  await tick();
  assert.equal(world.state.highContrast, true);
  world.unmount();
  const state = world.state;
  await tick();
  assert.equal(world.state, state);
});

test("Prefer Cross-Fade is preserved when Reduce Motion is off, including return from Settings", async () => {
  const world = fixture("ios", { crossFade: true });
  world.mount();
  await tick();
  assert.equal(world.state.reduceMotion, true);
  world.events.get("reduceMotionChanged")(false);
  await tick();
  assert.equal(world.state.reduceMotion, true);
  world.values.crossFade = false;
  world.events.get("appstate")("active");
  await tick();
  assert.equal(world.state.reduceMotion, false);
  world.unmount();
});

test("Android uses its contrast preference without calling iOS-only APIs", async () => {
  const world = fixture("android", { contrast: true });
  world.mount();
  await tick();
  assert.equal(world.state.highContrast, true);
  assert.deepEqual(world.calls.sort(), ["contrast", "motion"]);
  assert.ok(world.events.has("highTextContrastChanged"));
  world.unmount();
});

test("web tracks media preferences and unsubscribes on unmount", () => {
  const world = fixture("web");
  world.mount();
  const contrast = world.media.get("(prefers-contrast: more)");
  contrast.matches = true;
  contrast.listener();
  assert.equal(world.state.highContrast, true);
  assert.deepEqual(world.calls, []);
  world.unmount();
  assert.equal(contrast.listener, null);
});

test("shared modal disables transitions and routes accessibility escape through the safe close guard", () => {
  const world = fixture();
  let closed = 0;
  const Modal = world.load("src/AccessibleModal.tsx", {
    "./accessibilityPreferences": {
      useAccessibilityPreferences: () => ({ reduceMotion: true }),
    },
  }).default;
  const tree = Modal({
    visible: true,
    animationType: "slide",
    children: "content",
    onRequestClose: () => closed++,
  });
  assert.equal(tree.props.animationType, "none");
  const scope = tree.props.children[0];
  assert.equal(scope.props.accessibilityViewIsModal, true);
  scope.props.onAccessibilityEscape();
  assert.equal(closed, 1);
});
