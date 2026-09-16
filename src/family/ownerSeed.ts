import { State, validateState } from "../domain";
import { MAX_INVITED_FAMILY_MEMBERS } from "./invitationCapacity";
import { validateExtraRecords, type FamilyExtraRecord } from "./extras";

export const OWNER_SEED_MAX_BYTES = 32 * 1024 * 1024;
// Existing dispatched seeds must keep their exact serialized payload/digest
// when recovering a lost response. New reviews enforce the current limit.
const LEGACY_MAX_RECIPIENTS = 19;

export type OwnerSeedCounts = {
  feed: number;
  diaper: number;
  sleep: number;
  growth: number;
  milestone: number;
  care: number;
  total: number;
};
export type OwnerSeedSummary = {
  counts: OwnerSeedCounts;
  runningCount: number;
};
export type OwnerSeedDraft = {
  schemaVersion: 1;
  source: State;
  inviteeEmails: string[];
  counts: OwnerSeedCounts;
  extrasSchemaVersion?: 1;
  extraRecords?: FamilyExtraRecord[];
};

function invalid(code: string): never {
  throw new Error(code);
}

function copySource(source: State): State {
  try {
    // The domain validator constructs fresh objects and rejects unknown fields.
    // Do not spread arbitrary persisted values into this eventual upload payload.
    return validateState(source);
  } catch {
    return invalid("owner_invalid_data");
  }
}

function summary(source: State): OwnerSeedSummary {
  const counts: OwnerSeedCounts = {
    feed: 0,
    diaper: 0,
    sleep: 0,
    growth: 0,
    milestone: 0,
    care: source.careRecords?.length ?? 0,
    total: source.entries.length + (source.careRecords?.length ?? 0),
  };
  let runningCount = 0;
  for (const entry of source.entries) {
    counts[entry.type]++;
    if (entry.feedRunning || (entry.type === "sleep" && !entry.end))
      runningCount++;
  }
  return { counts, runningCount };
}

export function summarizeOwnerSeed(source: State): OwnerSeedSummary {
  return summary(copySource(source));
}

function normalizeEmail(value: string): string {
  if (typeof value !== "string") return invalid("owner_invalid_email");
  const email = value.trim().toLowerCase();
  const parts = email.split("@");
  if (email.length > 254 || parts.length !== 2)
    return invalid("owner_invalid_email");
  const [local, domain] = parts;
  if (
    !local ||
    local.length > 64 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !domain.includes(".") ||
    domain
      .split(".")
      .some(
        (label) =>
          label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
  )
    return invalid("owner_invalid_email");
  return email;
}

function normalizeRecipients(
  values: string[],
  ownEmail?: string,
  maxRecipients = MAX_INVITED_FAMILY_MEMBERS,
): string[] {
  const recipients = [...new Set(values.map(normalizeEmail))];
  if (recipients.length === 0) return invalid("owner_invalid_email");
  if (ownEmail && recipients.includes(ownEmail))
    return invalid("owner_self_invite");
  if (recipients.length > maxRecipients)
    return invalid("owner_recipient_limit");
  return recipients;
}

function draftFor(
  source: State,
  inviteeEmails: string[],
  extras?: FamilyExtraRecord[],
): OwnerSeedDraft {
  const cleanSource = copySource(source);
  const { counts, runningCount } = summary(cleanSource);
  if (runningCount > 0) return invalid("owner_active_timer");
  return {
    schemaVersion: 1,
    source: cleanSource,
    inviteeEmails,
    counts,
    ...(extras === undefined
      ? {}
      : {
          extrasSchemaVersion: 1 as const,
          extraRecords: validateExtraRecords(extras),
        }),
  };
}

function boundedUtf8(serialized: string, maximum: number) {
  let bytes = 0;
  // Count UTF-8 bytes without Node Buffer or an optional native TextEncoder.
  for (const character of serialized) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > maximum) return invalid("owner_data_too_large");
  }
}
function encode(draft: OwnerSeedDraft): string {
  // The existing medical-history limit is unchanged; additional space is only
  // for the reviewed avatar/settings/check-ins, not unbounded history imports.
  boundedUtf8(JSON.stringify(draft.source), 10 * 1024 * 1024);
  const serialized = JSON.stringify(draft);
  boundedUtf8(serialized, OWNER_SEED_MAX_BYTES);
  return serialized;
}

export function prepareOwnerSeed(
  source: State,
  emailsText: string,
  ownEmail: string,
  extras?: FamilyExtraRecord[],
): OwnerSeedDraft {
  if (typeof emailsText !== "string") return invalid("owner_invalid_email");
  const recipients = normalizeRecipients(
    emailsText.split(/[\s,;，；]+/).filter(Boolean),
    normalizeEmail(ownEmail),
  );
  const draft = draftFor(source, recipients, extras);
  encode(draft);
  return draft;
}

export function serializeOwnerSeed(draft: OwnerSeedDraft): string {
  if (
    !draft ||
    draft.schemaVersion !== 1 ||
    !Array.isArray(draft.inviteeEmails) ||
    (draft.extrasSchemaVersion !== undefined &&
      draft.extrasSchemaVersion !== 1) ||
    (draft.extrasSchemaVersion === 1) !== (draft.extraRecords !== undefined)
  )
    return invalid("owner_invalid_data");
  // Revalidate after review, derive counts again, and serialize only the contract.
  return encode(
    draftFor(
      draft.source,
      normalizeRecipients(
        draft.inviteeEmails,
        undefined,
        LEGACY_MAX_RECIPIENTS,
      ),
      draft.extraRecords,
    ),
  );
}
