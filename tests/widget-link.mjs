import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture(platform = "ios") {
  let listener, cleanup, resolveInitial;
  let opens = 0,
    removed = false;
  const initial = new Promise((resolve) => {
    resolveInitial = resolve;
  });
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/useWidgetHomeLink.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (name) => {
        if (name === "react")
          return {
            useRef: (current) => ({ current }),
            useEffect: (effect) => {
              cleanup = effect();
            },
          };
        if (name === "./widgetLink")
          return { isTodayWidgetLink: (url) => url === "mylittledays://today" };
        if (name === "react-native")
          return {
            Platform: { OS: platform },
            Linking: {
              getInitialURL: () => initial,
              addEventListener: (_name, handler) => {
                listener = handler;
                return {
                  remove: () => {
                    removed = true;
                  },
                };
              },
            },
          };
        throw new Error(name);
      },
    },
  );
  module.exports.useWidgetHomeLink(() => {
    opens++;
  });
  return {
    get opens() {
      return opens;
    },
    get removed() {
      return removed;
    },
    emit: (url) => listener?.({ url }),
    initial: resolveInitial,
    clean: () => cleanup?.(),
  };
}
test("cold and warm widget links go home, auth links do not", async () => {
  const f = fixture();
  f.initial("mylittledays://today");
  await Promise.resolve();
  assert.equal(f.opens, 1);
  f.emit("mylittledays://auth?code=abc");
  assert.equal(f.opens, 1);
  f.emit("mylittledays://today");
  assert.equal(f.opens, 2);
  f.clean();
  assert.equal(f.removed, true);
});
test("late initial link cannot override newer navigation or a removed listener", async () => {
  const f = fixture();
  f.emit("mylittledays://today");
  f.initial("mylittledays://today");
  await Promise.resolve();
  assert.equal(f.opens, 1);
  const closed = fixture();
  closed.clean();
  closed.initial("mylittledays://today");
  await Promise.resolve();
  assert.equal(closed.opens, 0);
  const web = fixture("web");
  web.initial("mylittledays://today");
  await Promise.resolve();
  assert.equal(web.opens, 0);
});
