import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import { familyConfig } from "./config";
import type { PilotIdentity } from "./identity";
import type { SharingOrigin } from "./pilotState";
import type { FamilyCacheGuard } from "./auth";
export type { FamilyCacheGuard } from "./auth";

type StoredTokens = {
  binding: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};
const key = "my-little-days.family-pilot.tokens";
const identityKey = "my-little-days.family-pilot.identity";
const logoutKey = "my-little-days.family-pilot.signed-out";
const guardKey = "my-little-days.family-pilot.cache-guard";
const binding = JSON.stringify(familyConfig);
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
let refresh: Promise<string> | null = null;
let generation = 0;
let signedOut = false;
let reauthenticationUser: string | null = null;
// Order native mutations across refresh, login and logout. An obsolete write
// must finish before the replacement session is stored, never erase it later.
let mutations: Promise<void> = Promise.resolve();
function mutate<T>(work: () => Promise<T>): Promise<T> {
  const result = mutations.then(work);
  mutations = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
const config = () => {
  if (!familyConfig) throw new Error("not_configured");
  return familyConfig;
};
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
function validOrigin(value: unknown): value is SharingOrigin {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const origin = value as Partial<SharingOrigin>;
  return [
    origin.userId,
    origin.familyId,
    origin.membershipId,
    origin.historyId,
  ].every(nonempty);
}
// Parsing is side-effect free: a delayed read from an old session must never
// restore its barrier after an explicit replacement login has cleared it.
async function readCacheGuard(
  userId?: string,
): Promise<FamilyCacheGuard | null> {
  const raw = await SecureStore.getItemAsync(guardKey, options);
  if (raw === null) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("local_data_invalid");
  }
  if (
    !value ||
    value.schema !== 1 ||
    value.binding !== binding ||
    !nonempty(value.userId) ||
    (userId !== undefined && value.userId !== userId) ||
    typeof value.reauthRequired !== "boolean" ||
    (value.origin !== null &&
      (!validOrigin(value.origin) || value.origin.userId !== value.userId))
  ) {
    throw new Error("local_data_invalid");
  }
  return {
    userId: value.userId,
    reauthRequired: value.reauthRequired,
    origin: value.origin,
  };
}
async function writeCacheGuard(guard: FamilyCacheGuard): Promise<void> {
  await SecureStore.setItemAsync(
    guardKey,
    JSON.stringify({ schema: 1, binding, ...guard }),
    options,
  );
}
// Used inside the mutation queue only. If one storage operation fails, another
// may still durably deny stale cache on restart. Never erase recovery identity.
async function invalidateStoredSession(): Promise<void> {
  try {
    await SecureStore.setItemAsync(logoutKey, binding, options);
    signedOut = true;
  } catch {
    try {
      await SecureStore.deleteItemAsync(key, options);
    } catch {
      /* Memory barrier still denies this process if all native writes fail. */
    }
  }
}
export async function loadCacheGuard(
  userId: string,
): Promise<FamilyCacheGuard | null> {
  if (!nonempty(userId)) throw new Error("local_data_invalid");
  const current = generation;
  return mutate(async () => {
    if (current !== generation || signedOut) throw new Error("session_changed");
    const guard = await readCacheGuard(userId);
    if (current !== generation || signedOut) throw new Error("session_changed");
    if (guard?.reauthRequired) reauthenticationUser = guard.userId;
    return guard;
  });
}
export async function markReauthenticationRequired(
  userId: string,
): Promise<void> {
  if (!nonempty(userId)) throw new Error("local_data_invalid");
  // Invalidate network responses before waiting for native storage. Identity is
  // retained so the account remains recognizable while explicit login is needed.
  reauthenticationUser = userId;
  generation++;
  refresh = null;
  await mutate(async () => {
    let origin: SharingOrigin | null = null;
    try {
      origin = (await readCacheGuard(userId))?.origin ?? null;
    } catch {
      /* A new deny marker repairs malformed guard data. */
    }
    try {
      await writeCacheGuard({ userId, reauthRequired: true, origin });
    } catch (error) {
      // Best-effort fallback: a failed guard write must not silently restore the
      // cached session next launch if another local invalidation can succeed.
      await invalidateStoredSession();
      throw error;
    }
  });
}
export async function saveCacheOrigin(origin: SharingOrigin): Promise<void> {
  if (!validOrigin(origin)) throw new Error("local_data_invalid");
  const current = generation;
  await mutate(async () => {
    if (current !== generation || signedOut) throw new Error("session_changed");
    const existing = await readCacheGuard(origin.userId);
    if (reauthenticationUser || existing?.reauthRequired)
      throw new Error("sign_in_required");
    if (current !== generation) throw new Error("session_changed");
    try {
      await writeCacheGuard({
        userId: origin.userId,
        reauthRequired: false,
        origin,
      });
    } catch (error) {
      // The previously stored history is no longer safe evidence of the newly
      // observed origin. Deny cached startup rather than reviving it on restart.
      reauthenticationUser = origin.userId;
      if (current === generation) generation++;
      refresh = null;
      await invalidateStoredSession();
      throw error;
    }
    if (current !== generation) throw new Error("session_changed");
  });
}
async function load(): Promise<StoredTokens | null> {
  await mutations;
  if (signedOut) return null;
  // A failed credential erase must not restore a signed-out session after process death.
  if ((await SecureStore.getItemAsync(logoutKey, options)) === binding) {
    signedOut = true;
    return null;
  }
  const raw = await SecureStore.getItemAsync(key, options);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as StoredTokens;
    return data.binding === binding &&
      typeof data.accessToken === "string" &&
      Number.isFinite(data.expiresAt)
      ? data
      : null;
  } catch {
    return null;
  }
}
async function store(
  token: AuthSession.TokenResponse,
  expectedGeneration: number,
  previousRefresh?: string,
  replaceIdentity = false,
) {
  return mutate(async () => {
    if (generation !== expectedGeneration) throw new Error("session_changed");
    if (!token.accessToken) throw new Error("sign_in_required");
    if (replaceIdentity)
      await SecureStore.deleteItemAsync(identityKey, options);
    if (generation !== expectedGeneration) throw new Error("session_changed");
    await SecureStore.setItemAsync(
      key,
      JSON.stringify({
        binding,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? previousRefresh,
        expiresAt: (token.issuedAt + (token.expiresIn ?? 300)) * 1000,
      } satisfies StoredTokens),
      options,
    );
    if (generation !== expectedGeneration) {
      // Still inside the mutation queue: no newer session can be written yet.
      // A known-expiry barrier keeps the local session recognizable, but never
      // permits this refreshed token to be returned or used without new login.
      if (replaceIdentity || signedOut || !reauthenticationUser)
        await SecureStore.deleteItemAsync(key, options);
      throw new Error("session_changed");
    }
    if (replaceIdentity) {
      // Only a successful, explicit new login can remove the durable logout barrier.
      await SecureStore.deleteItemAsync(logoutKey, options);
      if (generation !== expectedGeneration) throw new Error("session_changed");
      await SecureStore.deleteItemAsync(guardKey, options);
      if (generation !== expectedGeneration) throw new Error("session_changed");
      reauthenticationUser = null;
      signedOut = false;
    }
  });
}
export async function hasSession(): Promise<boolean> {
  return !!(await load());
}
export async function signIn(emailHint?: string): Promise<void> {
  const c = config(),
    current = ++generation;
  refresh = null;
  const discovery = await AuthSession.fetchDiscoveryAsync(c.authority);
  const redirectUri = AuthSession.makeRedirectUri({
    native: "mylittledays://auth",
  });
  const request = new AuthSession.AuthRequest({
    clientId: c.clientId,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    scopes: ["openid", "profile", "offline_access", c.scope],
    prompt: AuthSession.Prompt.Login,
    ...(emailHint ? { extraParams: { login_hint: emailHint } } : {}),
  });
  const result = await request.promptAsync(discovery);
  if (result.type === "cancel" || result.type === "dismiss")
    throw new Error("sign_in_cancelled");
  if (result.type !== "success" || !result.params.code || !request.codeVerifier)
    throw new Error("sign_in_failed");
  const token = await AuthSession.exchangeCodeAsync(
    {
      clientId: c.clientId,
      code: result.params.code,
      redirectUri,
      extraParams: { code_verifier: request.codeVerifier },
    },
    discovery,
  );
  // A newly authenticated account must be server-identified before cached data is shown.
  await store(token, current, undefined, true);
}
export async function signOut(): Promise<void> {
  generation++;
  signedOut = true;
  refresh = null;
  await mutate(async () => {
    let markerFailed = false;
    try {
      await SecureStore.setItemAsync(logoutKey, binding, options);
    } catch {
      markerFailed = true;
    }
    const results = await Promise.allSettled([
      SecureStore.deleteItemAsync(key, options),
      SecureStore.deleteItemAsync(identityKey, options),
    ]);
    if (markerFailed || results.some((result) => result.status === "rejected"))
      throw new Error("sign_out_failed");
  });
  // A future login explicitly prompts again; we do not claim to revoke all
  // Entra browser/device sessions or log the user out of other applications.
}
export async function loadIdentity(): Promise<PilotIdentity | null> {
  const current = generation;
  if (!(await load())) return null;
  const raw = await SecureStore.getItemAsync(identityKey, options);
  if (current !== generation || signedOut) return null;
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value?.binding === binding &&
      typeof value.identity?.user?.id === "string" &&
      Array.isArray(value.identity.families)
      ? value.identity
      : null;
  } catch {
    return null;
  }
}
export async function saveIdentity(identity: PilotIdentity): Promise<void> {
  const current = generation;
  await mutate(async () => {
    if (current !== generation || signedOut) throw new Error("session_changed");
    try {
      await SecureStore.setItemAsync(
        identityKey,
        JSON.stringify({ binding, identity }),
        options,
      );
    } catch (error) {
      // A fresh identity may revoke membership or narrow permissions. If it
      // cannot be stored, the older cached grants must not revive on restart.
      reauthenticationUser = identity.user.id;
      if (current === generation) generation++;
      refresh = null;
      await invalidateStoredSession();
      throw error;
    }
    if (current !== generation) {
      if (signedOut || reauthenticationUser !== identity.user.id)
        await SecureStore.deleteItemAsync(identityKey, options);
      throw new Error("session_changed");
    }
  });
}
// Expo's discovery/refresh helpers do not accept an AbortSignal. Bound each
// await against the same deadline so a hung SDK request cannot retain the
// shared refresh lock forever. Late results cannot advance to refresh/store.
async function tokenNetworkStep<T>(
  work: () => Promise<T>,
  deadline: number,
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("network_unavailable");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("network_unavailable")),
        remaining,
      );
    });
    return await Promise.race([work(), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getAccessToken(): Promise<string> {
  if (refresh) return refresh;
  const current = generation;
  const deadline = Date.now() + 15000;
  const work = async () => {
    const c = config(),
      token = await load();
    if (!token || current !== generation) throw new Error("sign_in_required");
    await mutations;
    const guard = await readCacheGuard();
    if (current !== generation || signedOut)
      throw new Error("sign_in_required");
    if (guard?.reauthRequired) reauthenticationUser = guard.userId;
    if (reauthenticationUser) throw new Error("sign_in_required");
    if (token.expiresAt > Date.now() + 60_000) return token.accessToken;
    if (!token.refreshToken) throw new Error("sign_in_required");
    const discovery = await tokenNetworkStep(
      () => AuthSession.fetchDiscoveryAsync(c.authority),
      deadline,
    );
    if (reauthenticationUser || current !== generation || signedOut)
      throw new Error("sign_in_required");
    try {
      const updated = await tokenNetworkStep(
        () =>
          AuthSession.refreshAsync(
            {
              clientId: c.clientId,
              refreshToken: token.refreshToken,
              scopes: ["openid", "profile", "offline_access", c.scope],
            },
            discovery,
          ),
        deadline,
      );
      await store(updated, current, token.refreshToken);
      if (reauthenticationUser || current !== generation || signedOut)
        throw new Error("sign_in_required");
      return updated.accessToken;
    } catch (error) {
      if (reauthenticationUser || error instanceof AuthSession.TokenError)
        throw new Error("sign_in_required");
      if (current !== generation || signedOut)
        throw new Error("session_changed");
      throw new Error("network_unavailable");
    }
  };
  const pending = work();
  refresh = pending;
  try {
    return await pending;
  } finally {
    if (refresh === pending) refresh = null;
  }
}
