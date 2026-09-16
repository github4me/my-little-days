import { familyConfig } from "./config";
import { getAccessToken } from "./auth";

export class PilotApiError extends Error {
  constructor(
    public code: string,
    public status = 0,
  ) {
    super(code);
  }
}
// Local timing diagnostics contain only fixed phases/outcomes and elapsed time.
// Never include URLs, request/response data, identities, tokens or error text.
function reportPhase(
  operation: "identity" | "read" | "write",
  phase: "token" | "api",
  startedAt: number,
  outcome: "ok" | "cancelled" | "timeout" | "authentication" | "failed",
) {
  try {
    console.info("[family-request]", {
      operation,
      phase,
      durationMs: Math.max(0, Date.now() - startedAt),
      outcome,
    });
  } catch {
    // Diagnostics must never affect authentication or recording.
  }
}

// Every call is to the configured first-party origin.
export async function familyRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (!familyConfig) throw new PilotApiError("not_configured");
  const config = familyConfig;
  if (!/^\/v[12]\//.test(path) || path.includes("://"))
    throw new PilotApiError("invalid_request");
  const diagnosticOperation =
    path === "/v1/me" && body === undefined
      ? "identity"
      : body === undefined
        ? "read"
        : "write";
  const timeout = new AbortController();
  const abort = () => timeout.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) timeout.abort();
  // A supported 12 MiB photo is roughly 16 MiB on the wire. Its creation,
  // updates and subsequent family downloads need the same bounded transfer
  // window; keep account and small-record failures responsive.
  const operation =
    body && typeof body === "object"
      ? (body as { collection?: unknown; extraRecord?: { kind?: unknown } })
      : null;
  const largeTransfer =
    path === "/v2/families" ||
    (body === undefined && /^\/v2\/families\/[^/?#]+\/snapshot$/.test(path)) ||
    (/^\/v2\/families\/[^/?#]+\/record-operations$/.test(path) &&
      operation?.collection === "extra" &&
      operation.extraRecord?.kind === "avatar");
  // Token acquisition and HTTP get separate budgets: refreshing an expired
  // token must not consume the first API request's entire transfer window.
  const apiTimeout = largeTransfer
    ? 120000
    : path === "/v1/me" && body === undefined
      ? 30000
      : 15000;
  // Native silent refresh has a 15s network deadline. This outer safety cap
  // must expire later, so a fresh retry cannot rejoin an expiring shared lock.
  let timer = setTimeout(abort, 20000);
  let abortWait = () => {};
  let phase: "token" | "api" = "token";
  let startedAt = Date.now();
  let responseStatus = 0;
  const knownClientError = () =>
    responseStatus >= 400 && responseStatus < 500
      ? new PilotApiError(
          responseStatus === 401
            ? "sign_in_required"
            : responseStatus === 403
              ? "forbidden"
              : "request_failed",
          responseStatus,
        )
      : null;
  try {
    if (timeout.signal.aborted) throw new PilotApiError("network_unavailable");
    // Discovery/token refresh is network work too. A stalled refresh must not
    // retain the sync lock indefinitely or send a request after this session ends.
    const aborted = new Promise<never>((_, reject) => {
      abortWait = () =>
        reject(knownClientError() ?? new PilotApiError("network_unavailable"));
      timeout.signal.addEventListener("abort", abortWait, { once: true });
    });
    const token = await Promise.race([getAccessToken(), aborted]);
    if (timeout.signal.aborted) throw new PilotApiError("network_unavailable");
    clearTimeout(timer);
    reportPhase(diagnosticOperation, phase, startedAt, "ok");
    phase = "api";
    startedAt = Date.now();
    timer = setTimeout(abort, apiTimeout);
    const send = async () => {
      const response = await fetch(`${config.apiUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: timeout.signal,
        redirect: "error",
      });
      if (timeout.signal.aborted)
        throw new PilotApiError("network_unavailable");
      responseStatus = response.status;
      // Headers already establish expiry. A slow/malformed error body must
      // never turn a confirmed 401 into a quietly retried connection failure.
      if (response.status === 401)
        throw new PilotApiError("sign_in_required", 401);
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          code?: string;
        } | null;
        const code =
          error?.code && /^[a-z_]{1,60}$/.test(error.code)
            ? error.code
            : response.status === 403
              ? "forbidden"
              : response.status >= 500
                ? "service_unavailable"
                : "request_failed";
        throw new PilotApiError(code, response.status);
      }
      return (await response.json()) as T;
    };
    const result = await Promise.race([send(), aborted]);
    if (timeout.signal.aborted) throw new PilotApiError("network_unavailable");
    reportPhase(diagnosticOperation, phase, startedAt, "ok");
    return result;
  } catch (error) {
    const code = (error as Error | null)?.message;
    reportPhase(
      diagnosticOperation,
      phase,
      startedAt,
      signal?.aborted
        ? "cancelled"
        : timeout.signal.aborted
          ? "timeout"
          : code === "sign_in_required" || code === "session_changed"
            ? "authentication"
            : "failed",
    );
    if (error instanceof PilotApiError) throw error;
    if (code === "sign_in_required" || code === "session_changed")
      throw new PilotApiError(code);
    const denied = knownClientError();
    if (denied) throw denied;
    throw new PilotApiError("network_unavailable");
  } finally {
    clearTimeout(timer);
    timeout.signal.removeEventListener("abort", abortWait);
    signal?.removeEventListener("abort", abort);
  }
}
