import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function clientBoundary() {
  const delays: number[] = [];
  const cancelled: number[] = [];
  const callbacks: Array<() => void> = [];
  const diagnostics: unknown[] = [];
  let now = 0;
  let request:
    | { url: string; signal: AbortSignal; headers: Record<string, string> }
    | undefined;
  let delayed = false;
  let delayedBody = false;
  let requestCount = 0;
  let responseStatus = 200;
  let responseBody: unknown = { ok: true };
  let jsonFails = false;
  let jsonCalls = 0;
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
    Date: { now: () => now },
    console: {
      info: (...values: unknown[]) =>
        diagnostics.push(JSON.parse(JSON.stringify(values))),
    },
    setTimeout(callback: () => void, delay: number) {
      delays.push(delay);
      callbacks.push(callback);
      return delays.length;
    },
    clearTimeout(id: number) {
      cancelled.push(id);
    },
    fetch: async (
      url: string,
      options: { signal: AbortSignal; headers: Record<string, string> },
    ) => {
      requestCount++;
      request = { url, signal: options.signal, headers: options.headers };
      if (delayed)
        await new Promise((_, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new Error("Aborted")),
          ),
        );
      return {
        ok: responseStatus >= 200 && responseStatus < 300,
        status: responseStatus,
        json: async () => {
          jsonCalls++;
          if (jsonFails) throw new Error("invalid private response");
          return delayedBody ? new Promise(() => {}) : responseBody;
        },
      };
    },
  });
  return {
    api: module.exports,
    delays,
    cancelled,
    callbacks,
    diagnostics,
    elapse: (elapsed: number) => {
      now += elapsed;
    },
    requestCount: () => requestCount,
    jsonCalls: () => jsonCalls,
    response: (status: number, body?: unknown) => {
      responseStatus = status;
      responseBody = body;
    },
    failJson: () => {
      jsonFails = true;
    },
    request: () => request,
    token: (request: () => Promise<string>) => {
      tokenRequest = request;
    },
    delay: () => {
      delayed = true;
    },
    delayBody: () => {
      delayedBody = true;
    },
  };
}

test("v2 requests opt into supplement-compatible snapshots without changing v1", async () => {
  const client = clientBoundary();
  for (const path of [
    "/v2/capabilities",
    "/v2/families",
    "/v2/families/family-a/snapshot",
  ]) {
    await client.api.familyRequest(path);
    assert.equal(client.request()?.headers["X-LittleDays-Care-Schema"], "2");
  }
  await client.api.familyRequest("/v1/me");
  assert.equal(
    client.request()?.headers["X-LittleDays-Care-Schema"],
    undefined,
  );
});

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
    ["/v1/me", undefined, 30000],
    ["/v1/session", undefined, 15000],
    ["/v2/capabilities", undefined, 15000],
    ["/v2/families/family-a/profile", { profile: {} }, 15000],
  ];
  for (const [path, body, timeout] of cases) {
    const client = clientBoundary();
    const result = await client.api.familyRequest<{ ok: boolean }>(path, body);
    assert.equal(result.ok, true);
    assert.deepEqual(client.delays, [20000, timeout], path);
    assert.deepEqual(
      client.cancelled,
      [1, 2],
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
  client.callbacks[1]();
  await assert.rejects(pending, /network_unavailable/);
  assert.equal(client.request()?.signal.aborted, true);
  assert.deepEqual(client.cancelled, [1, 2]);
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

test("slow token acquisition receives a fresh identity HTTP budget and private phase timings", async () => {
  const client = clientBoundary();
  let release!: (token: string) => void;
  client.token(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const pending = client.api.familyRequest("/v1/me");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(client.delays, [20000]);
  client.elapse(14000);
  release("private-token-not-for-logs");
  await pending;
  assert.deepEqual(client.delays, [20000, 30000]);
  assert.deepEqual(client.diagnostics, [
    [
      "[family-request]",
      {
        operation: "identity",
        phase: "token",
        durationMs: 14000,
        outcome: "ok",
      },
    ],
    [
      "[family-request]",
      { operation: "identity", phase: "api", durationMs: 0, outcome: "ok" },
    ],
  ]);
});

test("HTTP timeout includes stalled response parsing and never automatically retries a write", async () => {
  const client = clientBoundary();
  client.delayBody();
  const pending = client.api.familyRequest(
    "/v2/families/private-family/profile",
    {
      profile: { email: "private@example.invalid" },
    },
  );
  void pending.catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  client.elapse(15000);
  client.callbacks[1]();
  await assert.rejects(pending, /network_unavailable/);
  assert.equal(client.requestCount(), 1);
  assert.equal(client.request()?.signal.aborted, true);
  assert.deepEqual(client.diagnostics.at(-1), [
    "[family-request]",
    { operation: "write", phase: "api", durationMs: 15000, outcome: "timeout" },
  ]);
  assert.doesNotMatch(
    JSON.stringify(client.diagnostics),
    /private|Bearer|https:|profile/,
  );
});

test("session abort cancels HTTP immediately and diagnostics contain no error details", async () => {
  const client = clientBoundary();
  client.delay();
  const session = new AbortController();
  const pending = client.api.familyRequest("/v1/me", undefined, session.signal);
  void pending.catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  session.abort();
  await assert.rejects(pending, /network_unavailable/);
  assert.equal(client.request()?.signal.aborted, true);
  assert.deepEqual(client.diagnostics.at(-1), [
    "[family-request]",
    {
      operation: "identity",
      phase: "api",
      durationMs: 0,
      outcome: "cancelled",
    },
  ]);
});

test("an already cancelled session never begins authentication or an HTTP request", async () => {
  const client = clientBoundary();
  let tokens = 0;
  client.token(async () => {
    tokens++;
    return "unused";
  });
  const session = new AbortController();
  session.abort();
  await assert.rejects(
    client.api.familyRequest("/v1/me", undefined, session.signal),
    /network_unavailable/,
  );
  assert.equal(tokens, 0);
  assert.equal(client.requestCount(), 0);
});

test("HTTP 401 requires sign-in immediately without waiting for an error body", async () => {
  const client = clientBoundary();
  client.response(401);
  client.delayBody();
  await assert.rejects(client.api.familyRequest("/v1/me"), {
    code: "sign_in_required",
    status: 401,
  });
  assert.equal(client.jsonCalls(), 0);
  assert.deepEqual(client.cancelled, [1, 2]);
  assert.deepEqual(client.diagnostics.at(-1), [
    "[family-request]",
    {
      operation: "identity",
      phase: "api",
      durationMs: 0,
      outcome: "authentication",
    },
  ]);
});

test("known client denials retain their status when an error body stalls", async () => {
  for (const status of [400, 403, 404, 408, 409, 429]) {
    const client = clientBoundary();
    client.response(status);
    client.delayBody();
    const pending = client.api.familyRequest("/v1/me");
    void pending.catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    client.callbacks[1]();
    await assert.rejects(pending, {
      code: status === 403 ? "forbidden" : "request_failed",
      status,
    });
    assert.equal(client.requestCount(), 1);
  }
});

test("malformed client error bodies cannot turn access denial into a connection failure", async () => {
  for (const status of [400, 403, 409, 429]) {
    const client = clientBoundary();
    client.response(status);
    client.failJson();
    await assert.rejects(client.api.familyRequest("/v1/me"), {
      code: status === 403 ? "forbidden" : "request_failed",
      status,
    });
  }
});

test("normal 403 and other API errors preserve semantic codes and status", async () => {
  for (const [status, code] of [
    [403, "membership_revoked"],
    [409, "record_changed"],
    [503, "service_unavailable"],
    [503, "identity_unavailable"],
  ] as const) {
    const client = clientBoundary();
    client.response(status, { code });
    await assert.rejects(client.api.familyRequest("/v1/me"), { code, status });
  }
});

test("session recognition is a bounded authenticated first-party read with private diagnostics", async () => {
  const client = clientBoundary();
  const response = {
    status: "token_valid",
    userId: "11111111-1111-4111-8111-111111111111",
    accountAccess: "pending",
    familyAccess: "pending",
  };
  client.response(200, response);
  assert.equal(await client.api.familyRequest("/v1/session"), response);
  assert.equal(
    client.request()?.url,
    "https://family.example.invalid/v1/session",
  );
  assert.deepEqual(client.delays, [20000, 15000]);
  assert.equal(client.requestCount(), 1);
  assert.ok(
    JSON.stringify(client.diagnostics).includes('"operation":"session"'),
  );
  assert.ok(!JSON.stringify(client.diagnostics).includes(response.userId));
});

test("session HTTP denials and older-route 404 remain distinguishable from outages", async () => {
  for (const [status, code] of [
    [401, "sign_in_required"],
    [403, "forbidden"],
    [404, "request_failed"],
  ] as const) {
    const client = clientBoundary();
    client.response(status);
    client.failJson();
    await assert.rejects(client.api.familyRequest("/v1/session"), {
      code,
      status,
    });
  }
});

test("logout aborts session recognition before its HTTP deadline", async () => {
  const client = clientBoundary();
  client.delay();
  const session = new AbortController();
  const pending = client.api.familyRequest(
    "/v1/session",
    undefined,
    session.signal,
  );
  await new Promise((resolve) => setImmediate(resolve));
  session.abort();
  await assert.rejects(pending, /network_unavailable/);
  assert.equal(client.request()?.signal.aborted, true);
  assert.deepEqual(client.cancelled, [1, 2]);
});
