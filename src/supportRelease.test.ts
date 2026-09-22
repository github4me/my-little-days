import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { SUPPORT_PURCHASES_ENABLED } from "./support/release";

type Element = {
  type: unknown;
  props: Record<string, any>;
};

const createElement = (
  type: unknown,
  props: object | null,
  ...children: unknown[]
): Element => ({
  type,
  props: { ...props, children },
});

function load(file: string, dependencies: Record<string, unknown>) {
  const module = { exports: {} as Record<string, any> };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
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
      require(name: string) {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
      },
    },
  );
  return module.exports;
}

function provider(platform: string, enabled = SUPPORT_PURCHASES_ENABLED) {
  const unexpectedHook = () =>
    assert.fail("Disabled purchases must not mount store hooks");
  const contextProvider = Symbol("support-context");
  const api = load("src/support/SupportPurchaseProvider.tsx", {
    react: {
      createElement,
      createContext: () => ({ Provider: contextProvider }),
      useCallback: unexpectedHook,
      useContext: unexpectedHook,
      useEffect: unexpectedHook,
      useMemo: unexpectedHook,
      useReducer: unexpectedHook,
      useRef: unexpectedHook,
      useState: unexpectedHook,
    },
    "react-native": {
      Platform: { OS: platform },
      AppState: { addEventListener: unexpectedHook },
    },
    "./release": { SUPPORT_PURCHASES_ENABLED: enabled },
    "./catalog": {},
    "./purchaseState": {},
    "./purchaseCoordinator": {},
    // Deliberately no ./store or expo-iap: even loading either fails this test.
  });
  return { render: api.SupportPurchaseProvider, contextProvider };
}

test("this release keeps coffee hidden and inert without loading StoreKit on any platform", async () => {
  assert.equal(SUPPORT_PURCHASES_ENABLED, false);
  for (const platform of ["ios", "android", "web"]) {
    const { render, contextProvider } = provider(platform);
    const children = { app: "ordinary recording screens" };
    const element: Element = render({ children });
    assert.equal(element.type, contextProvider);
    assert.equal(element.props.children[0], children);
    const controller = element.props.value;
    assert.equal(controller.visible, false);
    assert.equal(controller.canPurchase, false);
    assert.equal(controller.status.kind, "unavailable");
    assert.equal(controller.products.length, 0);
    controller.selectProduct("com.littledays.babylog.tip.coffee");
    await controller.reloadProducts();
    await controller.purchase();
    assert.equal(controller.selectedProductId, null);
    assert.equal(controller.canPurchase, false);
    assert.equal(render({ children }).props.value, controller);
  }
});

test("the enabled implementation remains available behind the explicit release gate", () => {
  const { render, contextProvider } = provider("ios", true);
  const element: Element = render({ children: "app" });
  assert.notEqual(element.type, contextProvider);
  assert.equal(typeof element.type, "function");
  assert.equal(element.props.children[0], "app");
});

function route(visible: boolean) {
  const effects: (() => void)[] = [];
  let reloads = 0;
  let backs = 0;
  const controller = {
    visible,
    canPurchase: true,
    products: [],
    selectedProductId: null,
    status: { kind: "ready" },
    reloadProducts: async () => {
      reloads++;
    },
    selectProduct: () => assert.fail("No product selection during routing"),
    purchase: () => assert.fail("No purchase during routing"),
  };
  const api = load("src/support/SupportPurchaseRoute.tsx", {
    react: {
      createElement,
      useEffect: (effect: () => void) => effects.push(effect),
      useMemo: (factory: () => unknown) => factory(),
    },
    "react-native": {},
    "../i18n": { useI18n: () => ({ locale: "en" }) },
    "./SupportScreen": { default: "SupportScreen", __esModule: true },
    "./messages": { createSupportTranslator: () => (key: string) => key },
    "./SupportPurchaseProvider": { useSupportPurchases: () => controller },
  });
  const element: Element | null = api.default({
    onBack: () => {
      backs++;
    },
  });
  effects.forEach((effect) => effect());
  return { element, reloads, backs };
}

test("a stale coffee route returns to More without rendering products or loading them", () => {
  const disabled = route(false);
  assert.equal(disabled.element, null);
  assert.equal(disabled.reloads, 0);
  assert.equal(disabled.backs, 1);
  const enabled = route(true);
  assert.equal(enabled.element?.type, "SupportScreen");
  assert.equal(enabled.reloads, 1);
  assert.equal(enabled.backs, 0);
});

test("privacy keeps normal help but does not advertise unavailable purchases", () => {
  for (const enabled of [false, true]) {
    const api = load("src/PrivacySupport.tsx", {
      react: {
        createElement,
        useContext: () => ({}),
        useState: () => [false, () => {}],
      },
      "react-native": { View: "View", Pressable: "Pressable" },
      "./ui": { Card: "Card", T: "T", Theme: {}, heading: {}, row: {} },
      "./i18n": {
        t: (value: string) => value,
        useI18n: () => ({ localize: (_zh: string, en: string) => en }),
      },
      "./support/release": { SUPPORT_PURCHASES_ENABLED: enabled },
    });
    const titles: string[] = [];
    const visit = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== "object" || !("props" in node)) return;
      const element = node as Element;
      if (element.props.title) titles.push(element.props.title);
      visit(element.props.children);
    };
    visit(api.default({ onBack: () => {} }));
    assert.equal(titles.includes("可选支持"), enabled);
    assert.ok(titles.includes("备份与删除"));
    assert.ok(titles.includes("软件更新"));
  }
});
