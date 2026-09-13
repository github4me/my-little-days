import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import { familyConfig } from "./config";
import type { PilotIdentity } from "./identity";

type StoredTokens = {
  binding: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};
const key = "my-little-days.family-pilot.tokens";
const identityKey = "my-little-days.family-pilot.identity";
const binding = JSON.stringify(familyConfig);
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
let refresh: Promise<string> | null = null;
let generation = 0;
let signedOut = false;
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
async function load(): Promise<StoredTokens | null> {
  await mutations;
  if (signedOut) return null;
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
      await SecureStore.deleteItemAsync(key, options);
      throw new Error("session_changed");
    }
    if (replaceIdentity) signedOut = false;
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
    const results = await Promise.allSettled([
      SecureStore.deleteItemAsync(key, options),
      SecureStore.deleteItemAsync(identityKey, options),
    ]);
    if (results.some((result) => result.status === "rejected"))
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
    await SecureStore.setItemAsync(
      identityKey,
      JSON.stringify({ binding, identity }),
      options,
    );
    if (current !== generation) {
      await SecureStore.deleteItemAsync(identityKey, options);
      throw new Error("session_changed");
    }
  });
}
export async function getAccessToken(): Promise<string> {
  if (refresh) return refresh;
  const current = generation;
  const work = async () => {
    const c = config(),
      token = await load();
    if (!token || current !== generation) throw new Error("sign_in_required");
    if (token.expiresAt > Date.now() + 60_000) return token.accessToken;
    if (!token.refreshToken) throw new Error("sign_in_required");
    const discovery = await AuthSession.fetchDiscoveryAsync(c.authority);
    try {
      const updated = await AuthSession.refreshAsync(
        {
          clientId: c.clientId,
          refreshToken: token.refreshToken,
          scopes: ["openid", "profile", "offline_access", c.scope],
        },
        discovery,
      );
      await store(updated, current, token.refreshToken);
      return updated.accessToken;
    } catch (error) {
      if (error instanceof AuthSession.TokenError)
        throw new Error("sign_in_required");
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
