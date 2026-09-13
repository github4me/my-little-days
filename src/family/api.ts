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
  if (!path.startsWith("/v1/") || path.includes("://"))
    throw new PilotApiError("invalid_request");
  const token = await getAccessToken();
  const timeout = new AbortController();
  const abort = () => timeout.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) timeout.abort();
  const timer = setTimeout(abort, 15000);
  try {
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
    throw new PilotApiError("network_unavailable");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
