import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Pressable as WebPressable,
  Text as WebText,
  TextInput as WebTextInput,
} from "react-native-web";

// Check the real shared components' native-facing props and event wiring.
// Native layout, VoiceOver order and Dynamic Type rendering require a device.
function fixture({
  width = 390,
  fontScale = 1,
  boldText = false,
  isDark = false,
} = {}) {
  const colors = {
    isDark,
    text: "text",
    muted: "muted",
    primary: "primary",
    onPrimary: "onPrimary",
  };
  const flatten = (style) =>
    Array.isArray(style)
      ? Object.assign({}, ...style.map(flatten))
      : style || {};
  const react = {
    createContext: (value) => ({ value }),
    useContext: (context) => context.value,
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
  };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/ui.tsx", "utf8"), {
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
        if (name === "react-native")
          return {
            Text: "Text",
            View: "View",
            Pressable: "Pressable",
            TextInput: "TextInput",
            ActivityIndicator: "ActivityIndicator",
            StyleSheet: { flatten },
            useWindowDimensions: () => ({ width, fontScale }),
          };
        if (name === "./palette")
          return { light: colors, dark: { ...colors, isDark: true } };
        if (name === "./i18n")
          return { useI18n: () => ({ t: (value) => value }) };
        if (name === "./accessibilityPreferences")
          return { useAccessibilityPreferences: () => ({ boldText }) };
        if (name === "./CareIcon") return "CareIcon";
        throw new Error(`Unexpected dependency: ${name}`);
      },
    },
  );
  const children = (node) => node.props.children.flat(Infinity).filter(Boolean);
  return { ...module.exports, flatten, children };
}

test("body text uses the system Dynamic Type body ramp without a size ceiling", () => {
  const ui = fixture();
  const text = ui.T({ children: "宝宝的日常记录" });
  assert.equal(text.props.allowFontScaling, true);
  assert.equal(text.props.maxFontSizeMultiplier, 0);
  assert.equal(text.props.dynamicTypeRamp, "body");
  assert.equal(ui.flatten(text.props.style).fontSize, 17);
  assert.equal(text.props.numberOfLines, undefined);
  assert.equal(text.props.adjustsFontSizeToFit, undefined);
  assert.equal(
    ui.T({ children: "Title", dynamicTypeRamp: "title1" }).props
      .dynamicTypeRamp,
    "title1",
  );
});

test("Bold Text promotes ordinary text while preserving stronger explicit emphasis", () => {
  const ui = fixture({ boldText: true });
  assert.equal(
    ui.flatten(ui.T({ children: "Body" }).props.style).fontWeight,
    "600",
  );
  assert.equal(
    ui.flatten(
      ui.T({ children: "Caption", style: { fontWeight: "400" } }).props.style,
    ).fontWeight,
    "600",
  );
  assert.equal(
    ui.flatten(
      ui.T({ children: "Heading", style: [{ fontWeight: "800" }] }).props.style,
    ).fontWeight,
    "800",
  );
  const regular = fixture();
  assert.equal(
    regular.flatten(regular.T({ children: "Body" }).props.style).fontWeight,
    undefined,
  );
});

test("buttons allow wrapping and grow vertically, exposing disabled and busy states", () => {
  const ui = fixture();
  let pressed = 0;
  const active = ui.Button({
    label: "Review and confirm family records",
    onPress: () => pressed++,
  });
  active.props.onPress();
  assert.equal(pressed, 1);
  const style = ui.flatten(active.props.style({ pressed: false }));
  assert.ok(style.minHeight >= 44 && style.minWidth >= 44);
  assert.ok(style.paddingVertical > 0);
  assert.equal(style.height, undefined);
  const label = ui.children(active).find((child) => child.type === ui.T);
  assert.equal(label.props.numberOfLines, undefined);
  assert.equal(label.props.style.flexShrink, 1);
  for (const state of [{ disabled: true }, { busy: true }]) {
    const button = ui.Button({
      label: "Save",
      onPress: () => pressed++,
      ...state,
    });
    assert.equal(button.props.disabled, true);
    assert.equal(button.props.accessibilityState.disabled, true);
    assert.equal(button.props.onPress, undefined);
    assert.equal(button.props.accessibilityState.busy, !!state.busy);
    assert.equal(button.props["aria-busy"], !!state.busy);
    assert.equal(
      ui.children(button).some((child) => child.type === "ActivityIndicator"),
      !!state.busy,
    );
  }
});

const options = [
  { label: "Bottle feeding", value: "feed", icon: "◒" },
  { label: "Diaper changes", value: "diaper", icon: "♧" },
  { label: "Sleep records", value: "sleep", icon: "☾" },
];

test("installed React Native Web preserves busy/disabled buttons and readonly fields", () => {
  const ui = fixture();
  const button = ui.Button({ label: "Save", busy: true, onPress() {} });
  const buttonMarkup = renderToStaticMarkup(
    React.createElement(
      WebPressable,
      {
        disabled: button.props.disabled,
        "aria-busy": button.props["aria-busy"],
      },
      React.createElement(WebText, null, "Save"),
    ),
  );
  assert.match(buttonMarkup, /aria-busy="true"/);
  assert.match(buttonMarkup, /aria-disabled="true"/);
  const field = ui.Field({
    label: "Name",
    value: "Saved",
    editable: false,
    onChange() {},
  });
  const input = ui.children(field).find((child) => child.type === "TextInput");
  const inputMarkup = renderToStaticMarkup(
    React.createElement(WebTextInput, {
      editable: input.props.editable,
      value: input.props.value,
      accessibilityLabel: input.props.accessibilityLabel,
    }),
  );
  // This installed version maps editable=false to the native HTML readOnly
  // attribute. Do not turn it into disabled: the value must remain selectable.
  assert.match(inputMarkup, /readOnly=""/);
  assert.doesNotMatch(inputMarkup, /disabled=""/);
});
test("icon choices reflow at narrow widths and large text without ellipsis or shrinking", () => {
  for (const [settings, basis] of [
    [{ width: 390, fontScale: 1 }, 0],
    [{ width: 320, fontScale: 1 }, "46%"],
    [{ width: 768, fontScale: 1.5 }, "46%"],
    [{ width: 390, fontScale: 2 }, "100%"],
  ]) {
    const ui = fixture(settings);
    const group = ui.Chips({
      options,
      value: "feed",
      iconized: true,
      onChange() {},
    });
    assert.equal(group.props.style.flexWrap, "wrap");
    for (const chip of ui.children(group)) {
      assert.equal(chip.props.style.flexBasis, basis);
      assert.ok(
        chip.props.style.minWidth >= 44 && chip.props.style.minHeight >= 44,
      );
      const label = ui.children(chip).at(-1);
      assert.equal(label.props.numberOfLines, undefined);
      assert.equal(label.props.adjustsFontSizeToFit, undefined);
      assert.ok(label.props.style.fontSize >= 13);
    }
  }
});

test("selection is exposed to assistive technology and not communicated by color alone", () => {
  const ui = fixture();
  let selected;
  const group = ui.Chips({
    options,
    value: "feed",
    onChange: (value) => {
      selected = value;
    },
  });
  const [active, other] = ui.children(group);
  assert.equal(active.props.accessibilityState.selected, true);
  assert.equal(other.props.accessibilityState.selected, false);
  assert.ok(active.props.style.borderWidth > other.props.style.borderWidth);
  assert.equal(ui.children(active).at(-1).props.style.fontWeight, "700");
  other.props.onPress();
  assert.equal(selected, "diaper");
  const disabled = ui.Chips({
    options,
    value: "feed",
    disabled: true,
    onChange() {
      assert.fail("Disabled control activated");
    },
  });
  for (const chip of ui.children(disabled)) {
    assert.equal(chip.props.disabled, true);
    assert.equal(chip.props.accessibilityState.disabled, true);
    assert.equal(chip.props.onPress, undefined);
  }
});

test("fields keep accessible labels, uncapped input scaling, readable insets and noneditable state", () => {
  for (const isDark of [false, true]) {
    const ui = fixture({ isDark });
    const field = ui.Field({
      label: "宝宝姓名",
      value: "宝宝",
      onChange() {},
      editable: false,
    });
    const input = ui
      .children(field)
      .find((child) => child.type === "TextInput");
    assert.equal(input.props.accessibilityLabel, "宝宝姓名");
    assert.equal(input.props.accessibilityState.disabled, true);
    assert.equal(input.props.editable, false);
    assert.equal(input.props.allowFontScaling, true);
    assert.equal(input.props.maxFontSizeMultiplier, 0);
    assert.equal(input.props.keyboardAppearance, isDark ? "dark" : "light");
    assert.equal(input.props.style.fontSize, 17);
    assert.ok(input.props.style.minHeight >= 44);
    assert.ok(input.props.style.paddingVertical >= 12);
    assert.equal(input.props.style.height, undefined);
  }
});
