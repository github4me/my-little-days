import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import { getRandomBytesAsync, randomUUID } from "expo-crypto";
import { Platform } from "react-native";
import appConfig from "../../app.json";
import { familyConfig } from "./config";
import { familyRequest, PilotApiError } from "./api";
import { loadIdentity } from "./auth";
import {
  acceptPushReply,
  pushRegistrationLocale,
  pushCategories,
  readPushRegistration,
  samePushScope,
  validCategories,
  validPushLocales,
  type PushCapabilities,
  type PushCategory,
  type PushLocale,
  type PushRegistration,
  type PushScope,
} from "./familyPushCore";
import { setFamilyPushPresentation } from "./familyPushPresentation";
import type { FamilyPushView } from "./familyPush";

const key = "my-little-days.family-entry-push.v1";
const binding = JSON.stringify(familyConfig);
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const projectId = appConfig.expo.extra.eas.projectId;
const familyChannelNames: Record<PushLocale, string> = {
  en: "Family records",
  "zh-Hans": "家庭记录",
  "zh-Hant": "家庭記錄",
  fr: "Dossiers familiaux",
  de: "Familienaufzeichnungen",
  hi: "परिवार के रिकॉर्ड",
  it: "Registri di famiglia",
  ja: "家族の記録",
  ko: "가족 기록",
  es: "Registros familiares",
  th: "บันทึกครอบครัว",
  vi: "Nhật ký gia đình",
};
let active: PushScope | null = null;
let cached: PushRegistration | null = null;
let generation = 0;
let network: AbortController | null = null;
let presentationSuspended = false;
let mutations: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = mutations.then(work);
  mutations = result.catch(() => {});
  return result;
}
function present() {
  setFamilyPushPresentation(active, cached, presentationSuspended);
}
export function setFamilyPushContext(scope: PushScope | null) {
  if (samePushScope(active, scope) || (!active && !scope)) return;
  active = scope;
  generation++;
  network?.abort();
  present();
}
async function read() {
  cached = readPushRegistration(
    await SecureStore.getItemAsync(key, options),
    binding,
  );
  present();
  return cached;
}
async function save(s: PushRegistration) {
  // Persist before network or presentation. Never erase unknown registration state.
  await SecureStore.setItemAsync(key, JSON.stringify(s), options);
  cached = s;
  present();
  return s;
}
function view(s: PushRegistration | null): FamilyPushView {
  const same = samePushScope(active, s?.scope ?? null);
  return {
    supported: Platform.OS === "ios" || Platform.OS === "android",
    desiredEnabled: !!s && same && s.desiredEnabled,
    enabled:
      !!s &&
      same &&
      s.desiredEnabled &&
      s.enabled &&
      !s.pending &&
      Date.parse(s.expiresAt) > Date.now(),
    categories: same && s ? s.desiredCategories : ["feed", "diaper", "sleep"],
    pending:
      !!s &&
      (s.pending !== null ||
        (same &&
          (s.desiredEnabled !== s.enabled ||
            (s.desiredEnabled && Date.parse(s.expiresAt) <= Date.now())))),
  };
}
function current(e: number, scope: PushScope) {
  if (e !== generation || !samePushScope(active, scope))
    throw new Error("push_context_changed");
}
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("network_unavailable");
  let cancel = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    cancel = () => reject(new Error("network_unavailable"));
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    return await Promise.race([work, interrupted]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
async function sendPending(s: PushRegistration, signal?: AbortSignal) {
  const pending = s.pending;
  if (!pending) return s;
  const identity = await loadIdentity();
  // Revocation-only requests may clean this installation after an account switch.
  // Never replay an old family's registration with the new account's credentials.
  if (
    !identity ||
    (pending.kind === "register" && identity.user.id !== s.scope.userId)
  )
    throw new Error("push_previous_account");
  const suffix = pending.kind === "unregister" ? "/unregister" : "";
  try {
    const reply = await familyRequest<unknown>(
      `/v2/push/installations/${s.installationId}${suffix}`,
      pending.body,
      signal,
      pending.kind === "register" ? "PUT" : undefined,
    );
    return save(acceptPushReply(s, reply));
  } catch (cause) {
    // Only an explicit missing, expired binding can be recreated. Never turn a
    // conflict, generic 404 or unknown HTTP result into another installation.
    // A new UUID/secret prevents old payloads matching a reset generation.
    if (
      !(cause instanceof PilotApiError) ||
      cause.status !== 404 ||
      cause.code !== "push_installation_unknown" ||
      s.generation === 0 ||
      Date.parse(s.expiresAt) > Date.now()
    )
      throw cause;
    const bytes = await getRandomBytesAsync(32);
    return save({
      ...s,
      installationId: randomUUID(),
      secret: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
        "",
      ),
      generation: 0,
      enabled: false,
      categories: [],
      token: null,
      locale: null,
      pending: null,
      expiresAt: new Date(0).toISOString(),
    });
  }
}
function isDefinitivelyUnappliedRegister(
  s: PushRegistration,
  cause: unknown,
  includeAccessRejection = false,
) {
  if (s.pending?.kind !== "register" || !(cause instanceof PilotApiError))
    return false;
  // A rolled-back API rejects a newer canonical locale before applying the
  // request. If it had already applied, its operation receipt would be returned
  // before request validation, so this exact response is safe to discard.
  if (cause.status === 422 && cause.code === "invalid_input") return true;
  return (
    includeAccessRejection &&
    [403, 409].includes(cause.status) &&
    ["membership_changed", "membership_revoked", "history_changed"].includes(
      cause.code,
    )
  );
}
async function disable(s: PushRegistration, signal?: AbortSignal) {
  s = await save({ ...s, desiredEnabled: false });
  // Resolve ambiguous preceding request before advancing the generation.
  if (s.pending) {
    try {
      s = await sendPending(s, signal);
    } catch (cause) {
      // These exact non-replay server denials prove this registration never
      // applied. Preserve the earlier binding proof so it can still be revoked.
      if (!isDefinitivelyUnappliedRegister(s, cause, true)) throw cause;
      s = await save({ ...s, pending: null });
    }
  }
  if (s.generation === 0 || !s.enabled) return s;
  s = await save({
    ...s,
    pending: {
      kind: "unregister",
      body: {
        operationId: randomUUID(),
        installationSecret: s.secret,
        expectedGeneration: s.generation,
      },
    },
  });
  return sendPending(s, signal);
}
async function capabilities(signal: AbortSignal): Promise<PushCapabilities> {
  let c: PushCapabilities;
  try {
    c = await familyRequest<PushCapabilities>(
      "/v2/push/capabilities",
      undefined,
      signal,
    );
  } catch (e) {
    if (e instanceof PilotApiError && e.status === 404)
      throw new Error("push_unavailable");
    throw e;
  }
  if (
    !c ||
    !c.registrationEnabled ||
    c.projectId !== projectId ||
    !validCategories(c.categories) ||
    (c.supportedLocales !== undefined && !validPushLocales(c.supportedLocales))
  )
    throw new Error("push_unavailable");
  return c;
}
async function token(ask: boolean, locale: PushLocale) {
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("family-entries", {
      name: familyChannelNames[locale],
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  let p = await Notifications.getPermissionsAsync();
  if (ask && !p.granted) p = await Notifications.requestPermissionsAsync();
  if (
    !p.granted &&
    p.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL
  )
    throw new Error("push_permission_denied");
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}
async function configure(
  enabled: boolean,
  categories: PushCategory[],
  locale: PushLocale,
  ask: boolean,
) {
  if (!validCategories(categories) || (enabled && categories.length === 0))
    throw new Error("push_category_required");
  categories = pushCategories.filter((c) => categories.includes(c));
  const scope = active;
  if (!scope) throw new Error("push_refresh_required");
  const e = generation;
  let s = await read();
  const abort = new AbortController();
  network = abort;
  // Includes OS token registration: Expo's token request is not abortable, but a
  // late result is barred by the epoch and cannot create a first-party request.
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    current(e, scope);
    if (!enabled) {
      if (s) s = await disable(s, abort.signal);
      current(e, scope);
      return view(s);
    }
    const available = await capabilities(abort.signal);
    const registrationLocale = pushRegistrationLocale(
      locale,
      available.supportedLocales,
    );
    current(e, scope);
    if (s && !samePushScope(s.scope, scope)) {
      s = await disable(s, abort.signal);
      current(e, scope);
      // Reuse ownership proof and generation after explicit revocation; no token
      // theft/rebinding fallback on 409 or cross-account pending registrations.
      s = await save({
        ...s,
        scope,
        desiredCategories: categories,
        desiredEnabled: false,
      });
    }
    if (!s) {
      const bytes = await getRandomBytesAsync(32);
      current(e, scope);
      s = await save({
        schema: 1,
        binding,
        scope,
        installationId: randomUUID(),
        secret: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
          "",
        ),
        generation: 0,
        enabled: false,
        desiredEnabled: false,
        categories: [],
        desiredCategories: categories,
        expiresAt: new Date(0).toISOString(),
        token: null,
        locale: null,
        pending: null,
      });
    }
    const expoPushToken = await abortable(token(ask, locale), abort.signal);
    current(e, scope);
    if (abort.signal.aborted) throw new Error("network_unavailable");
    s = await save({
      ...s,
      desiredEnabled: true,
      desiredCategories: categories,
    });
    if (s.pending) {
      try {
        s = await sendPending(s, abort.signal);
      } catch (cause) {
        // Recover a durable canonical-locale request after an API rollback.
        // The current capability response determines the replacement locale
        // (legacy en/zh or a supported canonical locale).
        if (!isDefinitivelyUnappliedRegister(s, cause)) throw cause;
        s = await save({ ...s, pending: null });
      }
    }
    current(e, scope);
    const unchanged =
      s.enabled &&
      s.token === expoPushToken &&
      s.locale === registrationLocale &&
      JSON.stringify(s.categories) === JSON.stringify(categories);
    if (unchanged && Date.parse(s.expiresAt) > Date.now() + 12 * 3600000) {
      presentationSuspended = false;
      present();
      return view(s);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      s = await save({
        ...s,
        pending: {
          kind: "register",
          body: {
            operationId: randomUUID(),
            installationSecret: s.secret,
            expectedGeneration: s.generation,
            expoPushToken,
            projectId,
            platform: Platform.OS === "ios" ? "ios" : "android",
            locale: registrationLocale,
            enabled: true,
            categories,
            familyId: scope.familyId,
            membershipId: scope.membershipId,
            historyId: scope.historyId,
          },
        },
      });
      s = await sendPending(s, abort.signal);
      current(e, scope);
      if (s.generation !== 0) break;
    }
    current(e, scope);
    presentationSuspended = false;
    present();
    return view(s);
  } finally {
    clearTimeout(timer);
    if (network === abort) network = null;
  }
}
export async function loadFamilyPush(): Promise<FamilyPushView> {
  return serial(async () => view(await read()));
}
export async function configureFamilyPush(
  enabled: boolean,
  categories: PushCategory[],
  locale: PushLocale,
) {
  // Stop in-process presentation immediately on opt-out; persistence/network are
  // serialized so a delayed enable response cannot silently undo the opt-out.
  if (!enabled) {
    presentationSuspended = true;
    setFamilyPushPresentation(null, null);
  }
  return serial(() => configure(enabled, categories, locale, enabled));
}
export async function reconcileFamilyPush(locale: PushLocale) {
  return serial(async () => {
    const s = await read();
    if (!s || !active) return view(s);
    if (!samePushScope(s.scope, active) || !s.desiredEnabled) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 5000);
      try {
        return view(await disable(s, abort.signal));
      } finally {
        clearTimeout(timer);
      }
    }
    try {
      return await configure(true, s.desiredCategories, locale, false);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "push_permission_denied")
        await save({ ...((await read()) ?? s), desiredEnabled: false });
      throw cause;
    }
  });
}
export async function prepareFamilyPushLogout(): Promise<void> {
  presentationSuspended = true;
  setFamilyPushPresentation(null, null);
  network?.abort();
  await serial(async () => {
    let s = await read();
    if (!s) return;
    s = await save({ ...s, desiredEnabled: false });
    setFamilyPushPresentation(null, null);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 3000);
    try {
      await disable(s, abort.signal);
    } finally {
      clearTimeout(timer);
      setFamilyPushPresentation(null, null);
    }
  });
}
