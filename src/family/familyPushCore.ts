import { SUPPORTED_LOCALES, type SupportedLocale } from "../locales";

// Push registration is not account authorization. Keep pending requests durable:
// a lost HTTP response must replay the original operation, not advance a binding.
export const pushCategories = ["feed", "diaper", "sleep"] as const;
export type PushCategory = (typeof pushCategories)[number];
export const pushLocales = SUPPORTED_LOCALES;
export type PushLocale = SupportedLocale;
// `zh` is accepted only for an already deployed v1 API that did not advertise
// locale capabilities. New APIs and registrations use canonical app locale IDs.
export type PushRegistrationLocale = PushLocale | "zh";
export type PushScope = {
  userId: string;
  familyId: string;
  membershipId: string;
  historyId: string;
};
export type PushReply = {
  operationId: string;
  installationId: string;
  generation: number;
  enabled: boolean;
  categories: PushCategory[];
  expiresAt: string;
};
export type PushRequest = {
  operationId: string;
  installationSecret: string;
  expectedGeneration: number;
  expoPushToken?: string;
  projectId?: string;
  platform?: "ios" | "android";
  locale?: PushRegistrationLocale;
  enabled?: boolean;
  categories?: PushCategory[];
  familyId?: string;
  membershipId?: string;
  historyId?: string;
};
export type PushRegistration = {
  schema: 1;
  binding: string;
  scope: PushScope;
  installationId: string;
  secret: string;
  generation: number;
  enabled: boolean;
  categories: PushCategory[];
  desiredEnabled: boolean;
  desiredCategories: PushCategory[];
  expiresAt: string;
  token: string | null;
  locale: PushRegistrationLocale | null;
  pending: { kind: "register" | "unregister"; body: PushRequest } | null;
};
export type PushCapabilities = {
  registrationEnabled: boolean;
  eventCreationEnabled: boolean;
  categories: PushCategory[];
  projectId: string | null;
  // Capability lists may contain locales added by a newer API. Older clients
  // validate the wire format, then intersect the list with their own catalog.
  supportedLocales?: string[];
};
export const samePushScope = (a: PushScope | null, b: PushScope | null) =>
  !!a &&
  !!b &&
  a.userId === b.userId &&
  a.familyId === b.familyId &&
  a.membershipId === b.membershipId &&
  a.historyId === b.historyId;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validPushScope(value: unknown): value is PushScope {
  if (!value || typeof value !== "object") return false;
  const s = value as PushScope;
  return [s.userId, s.familyId, s.membershipId, s.historyId].every(
    (v) => typeof v === "string" && uuid.test(v),
  );
}
export function validCategories(value: unknown): value is PushCategory[] {
  return (
    Array.isArray(value) &&
    value.length <= 3 &&
    new Set(value).size === value.length &&
    value.every((v) => pushCategories.includes(v))
  );
}
export function validPushLocale(value: unknown): value is PushLocale {
  return (
    typeof value === "string" &&
    (pushLocales as readonly string[]).includes(value)
  );
}
export function validPushRegistrationLocale(
  value: unknown,
): value is PushRegistrationLocale {
  return value === "zh" || validPushLocale(value);
}
const capabilityLocale = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
export function validPushLocales(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 64 &&
    new Set(value).size === value.length &&
    value.every(
      (locale) =>
        typeof locale === "string" &&
        locale.length <= 35 &&
        capabilityLocale.test(locale),
    ) &&
    value.includes("en")
  );
}
export function pushRegistrationLocale(
  locale: PushLocale,
  supportedLocales: readonly string[] | undefined,
): PushRegistrationLocale {
  if (supportedLocales?.includes(locale)) return locale;
  // A missing list identifies the legacy en/zh capability response. Only
  // actual Chinese locales use its Chinese bucket; every other locale is English.
  if (!supportedLocales && (locale === "zh-Hans" || locale === "zh-Hant"))
    return "zh";
  return "en";
}
export function readPushRegistration(
  raw: string | null,
  binding: string,
): PushRegistration | null {
  if (raw === null) return null;
  let s: PushRegistration & {
    locale?: PushRegistrationLocale | null;
  };
  try {
    s = JSON.parse(raw);
  } catch {
    throw new Error("push_storage_invalid");
  }
  if (
    !s ||
    s.schema !== 1 ||
    s.binding !== binding ||
    !validPushScope(s.scope) ||
    !uuid.test(s.installationId) ||
    !/^[a-f0-9]{64}$/.test(s.secret) ||
    !Number.isSafeInteger(s.generation) ||
    s.generation < 0 ||
    typeof s.enabled !== "boolean" ||
    typeof s.desiredEnabled !== "boolean" ||
    !validCategories(s.categories) ||
    !validCategories(s.desiredCategories) ||
    !Number.isFinite(Date.parse(s.expiresAt)) ||
    (s.token !== null &&
      (typeof s.token !== "string" || s.token.length > 300)) ||
    (s.locale !== undefined &&
      s.locale !== null &&
      !validPushRegistrationLocale(s.locale))
  )
    throw new Error("push_storage_invalid");
  if (s.pending !== null) {
    const p = s.pending;
    if (
      !p ||
      !["register", "unregister"].includes(p.kind) ||
      !p.body ||
      !uuid.test(p.body.operationId) ||
      p.body.installationSecret !== s.secret ||
      p.body.expectedGeneration !== s.generation ||
      (p.kind === "register" &&
        (p.body.familyId !== s.scope.familyId ||
          p.body.membershipId !== s.scope.membershipId ||
          p.body.historyId !== s.scope.historyId ||
          typeof p.body.enabled !== "boolean" ||
          !validCategories(p.body.categories) ||
          typeof p.body.expoPushToken !== "string" ||
          p.body.expoPushToken.length > 300 ||
          !uuid.test(p.body.projectId ?? "") ||
          !["ios", "android"].includes(p.body.platform ?? "") ||
          !validPushRegistrationLocale(p.body.locale)))
    )
      throw new Error("push_storage_invalid");
  }
  return { ...s, locale: s.locale ?? null };
}
export function acceptPushReply(
  s: PushRegistration,
  value: unknown,
): PushRegistration {
  const r = value as PushReply;
  const p = s.pending;
  if (
    !p ||
    !r ||
    r.operationId !== p.body.operationId ||
    r.installationId !== s.installationId ||
    r.generation !== s.generation + 1 ||
    (r.enabled !== false &&
      r.enabled !== (p.kind === "register" && p.body.enabled === true)) ||
    !validCategories(r.categories) ||
    !Number.isFinite(Date.parse(r.expiresAt)) ||
    (p.kind === "register" &&
      JSON.stringify([...r.categories].sort()) !==
        JSON.stringify([...p.body.categories!].sort()))
  )
    throw new Error("push_response_invalid");
  return {
    ...s,
    generation: r.generation,
    enabled: r.enabled,
    categories: r.categories,
    expiresAt: r.expiresAt,
    token: p.kind === "register" && r.enabled ? p.body.expoPushToken! : null,
    locale: p.kind === "register" ? p.body.locale! : s.locale,
    pending: null,
  };
}
export type FamilyEntryPush = {
  kind: "family-entry";
  eventId: string;
  familyId: string;
  membershipId: string;
  historyId: string;
  installationId: string;
  generation: number;
};
export function isFamilyEntryPush(value: unknown): value is FamilyEntryPush {
  if (!value || typeof value !== "object") return false;
  const p = value as FamilyEntryPush;
  return (
    p.kind === "family-entry" &&
    [
      p.eventId,
      p.familyId,
      p.membershipId,
      p.historyId,
      p.installationId,
    ].every((v) => typeof v === "string" && uuid.test(v)) &&
    Number.isSafeInteger(p.generation) &&
    p.generation > 0
  );
}
export function allowsFamilyEntryPush(
  data: unknown,
  scope: PushScope | null,
  s: PushRegistration | null,
  now = Date.now(),
) {
  return (
    isFamilyEntryPush(data) &&
    !!s &&
    samePushScope(scope, s.scope) &&
    s.desiredEnabled &&
    s.enabled &&
    !s.pending &&
    Date.parse(s.expiresAt) > now &&
    data.familyId === s.scope.familyId &&
    data.membershipId === s.scope.membershipId &&
    data.historyId === s.scope.historyId &&
    data.installationId === s.installationId &&
    data.generation === s.generation
  );
}

// A previously delivered alert is a navigation intent, not permission to show a
// new alert or read records. Renewal/opt-out must not strand its tap. The caller
// must additionally verify fresh server access before navigating.
export function allowsFamilyEntryPushOpen(
  data: unknown,
  scope: PushScope | null,
  s: PushRegistration | null,
) {
  return (
    isFamilyEntryPush(data) &&
    !!s &&
    samePushScope(scope, s.scope) &&
    data.familyId === s.scope.familyId &&
    data.membershipId === s.scope.membershipId &&
    data.historyId === s.scope.historyId &&
    data.installationId === s.installationId &&
    data.generation <= s.generation
  );
}
