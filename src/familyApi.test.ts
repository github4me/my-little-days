import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function clientBoundary() {
  const delays: number[] = [];
  const cancelled: number[] = [];
  const callbacks: Array<() => void> = [];
  let request: { url: string; signal: AbortSignal } | undefined;
  let delayed = false;
  let tokenRequest = async () => "synthetic-test-only";
  const module = {
    exports: {} as {
      familyRequest<T>(
        path: string,
        body?: unknown,
        signal?: AbortSignal,
      ): Promise<T>;
    },
  };
  const source = readFileSync(
    new URL("./family/api.ts", import.meta.url),
    "utf8",
  );
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(javascript, {
    exports: module.exports,
    require(id: string) {
      if (id === "./config")
        return { familyConfig: { apiUrl: "https://family.example.invalid" } };
      if (id === "./auth") return { getAccessToken: () => tokenRequest() };
      throw new Error(`Unexpected dependency: ${id}`);
    },
    AbortController,
    setTimeout(callback: () => void, delay: number) {
      delays.push(delay);
      callbacks.push(callback);
      return delays.length;
    },
    clearTimeout(id: number) {
      cancelled.push(id);
    },
    fetch: async (url: string, options: { signal: AbortSignal }) => {
      request = { url, signal: options.signal };
      if (delayed)
        await new Promise((_, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new Error("Aborted")),
          ),
        );
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  return {
    api: module.exports,
    delays,
    cancelled,
    callbacks,
    request: () => request,
    token: (request: () => Promise<string>) => {
      tokenRequest = request;
    },
    delay: () => {
      delayed = true;
    },
  };
}

test("family snapshots and avatar uploads retain a bounded two-minute transfer window", async () => {
  const cases: Array<[string, unknown, number]> = [
    ["/v2/families", { seed: {} }, 120000],
    ["/v2/families/family-a/snapshot", undefined, 120000],
    [
      "/v2/families/family-a/record-operations",
      {
        collection: "extra",
        extraRecord: { kind: "avatar", dataUrl: "synthetic" },
      },
      120000,
    ],
    [
      "/v2/families/family-a/record-operations",
      { collection: "care", careRecord: { kind: "temperature" } },
      15000,
    ],
    [
      "/v2/families/family-a/record-operations",
      { collection: "extra", extraRecord: { kind: "play-checkin" } },
      15000,
    ],
    ["/v1/me", undefined, 15000],
    ["/v2/capabilities", undefined, 15000],
    ["/v2/families/family-a/profile", { profile: {} }, 15000],
  ];
  for (const [path, body, timeout] of cases) {
    const client = clientBoundary();
    const result = await client.api.familyRequest<{ ok: boolean }>(path, body);
    assert.equal(result.ok, true);
    assert.deepEqual(client.delays, [timeout], path);
    assert.deepEqual(
      client.cancelled,
      [1],
      "settled requests release their timer",
    );
    assert.equal(client.request()?.signal.aborted, false);
  }
});

test("long snapshot requests still abort and release their timeout", async () => {
  const client = clientBoundary();
  client.delay();
  const pending = client.api.familyRequest("/v2/families/family-a/snapshot");
  await new Promise((resolve) => setImmediate(resolve));
  client.callbacks[0]();
  await assert.rejects(pending, /network_unavailable/);
  assert.equal(client.request()?.signal.aborted, true);
  assert.deepEqual(client.cancelled, [1]);
});

test("stalled token refresh is bounded and a late token never sends a timed-out request", async () => {
  const client = clientBoundary();
  let release!: (value: string) => void;
  client.token(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const pending = client.api.familyRequest("/v1/me");
  void pending.catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(
      typeof client.callbacks[0],
      "function",
      "token acquisition must be inside the request deadline",
    );
    client.callbacks[0]();
    await assert.rejects(pending, /network_unavailable/);
    release("late-token");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(client.request(), undefined);
    assert.deepEqual(client.cancelled, [1]);
  } finally {
    release("cleanup-token");
    await pending.catch(() => {});
  }
});

test("session abort settles while token refresh is pending and never sends after late completion", async () => {
  const client = clientBoundary();
  let release!: (value: string) => void;
  client.token(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const session = new AbortController();
  const pending = client.api.familyRequest("/v1/me", undefined, session.signal);
  let failed = false;
  void pending.catch(() => {
    failed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  session.abort();
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(
      failed,
      true,
      "cancelling the session must not wait for token refresh",
    );
    await assert.rejects(pending, /network_unavailable/);
    release("late-token");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(client.request(), undefined);
    assert.deepEqual(client.cancelled, [1]);
  } finally {
    release("cleanup-token");
    await pending.catch(() => {});
  }
});

test("token expiry and session replacement retain their authentication errors", async () => {
  for (const code of ["sign_in_required", "session_changed"]) {
    const client = clientBoundary();
    client.token(async () => {
      throw new Error(code);
    });
    await assert.rejects(client.api.familyRequest("/v1/me"), new RegExp(code));
    assert.equal(client.request(), undefined);
  }
});
