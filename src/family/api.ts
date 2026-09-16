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
// Every call is to the configured first-party origin. No request/response/token logging.
export async function familyRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (!familyConfig) throw new PilotApiError("not_configured");
  if (!/^\/v[12]\//.test(path) || path.includes("://"))
    throw new PilotApiError("invalid_request");
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
  const timer = setTimeout(abort, largeTransfer ? 120000 : 15000);
  let abortTokenWait = () => {};
  try {
    if (timeout.signal.aborted) throw new PilotApiError("network_unavailable");
    // Discovery/token refresh is network work too. A stalled refresh must not
    // retain the sync lock indefinitely or send a request after this session ends.
    const tokenAborted = new Promise<never>((_, reject) => {
      abortTokenWait = () => reject(new PilotApiError("network_unavailable"));
      timeout.signal.addEventListener("abort", abortTokenWait, { once: true });
    });
    const token = await Promise.race([getAccessToken(), tokenAborted]);
    if (timeout.signal.aborted) throw new PilotApiError("network_unavailable");
    const response = await fetch(`${familyConfig.apiUrl}${path}`, {
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
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as {
        code?: string;
      } | null;
      const code =
        error?.code && /^[a-z_]{1,60}$/.test(error.code)
          ? error.code
          : response.status === 401
            ? "sign_in_required"
            : response.status >= 500
              ? "service_unavailable"
              : "request_failed";
      throw new PilotApiError(code, response.status);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof PilotApiError) throw error;
    const code = (error as Error | null)?.message;
    if (code === "sign_in_required" || code === "session_changed")
      throw new PilotApiError(code);
    throw new PilotApiError("network_unavailable");
  } finally {
    clearTimeout(timer);
    timeout.signal.removeEventListener("abort", abortTokenWait);
    signal?.removeEventListener("abort", abort);
  }
}
