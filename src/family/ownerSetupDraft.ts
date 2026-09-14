import {
  OWNER_SEED_MAX_BYTES,
  OwnerSeedDraft,
  prepareOwnerSeed,
  serializeOwnerSeed,
} from "./ownerSeed";

export function serializeOwnerSetupDraft(draft: OwnerSeedDraft): string {
  return serializeOwnerSeed(draft);
}

export function parseStoredOwnerSetup(
  raw: string | null,
  ownEmail: string,
): OwnerSeedDraft | null {
  if (raw === null) return null;
  try {
    if (raw.length > OWNER_SEED_MAX_BYTES) throw new Error();
    const value = JSON.parse(raw) as OwnerSeedDraft;
    if (
      !value ||
      Object.keys(value).some(
        (key) =>
          !["schemaVersion", "source", "inviteeEmails", "counts"].includes(key),
      )
    )
      throw new Error();
    // Revalidate the stored contract before joining recipient strings; a single
    // corrupted list item must not be interpreted as multiple email addresses.
    const canonical = JSON.parse(serializeOwnerSeed(value)) as OwnerSeedDraft;
    const restored = prepareOwnerSeed(
      canonical.source,
      canonical.inviteeEmails.join("\n"),
      ownEmail,
    );
    if (
      !value.counts ||
      Object.keys(value.counts).length !==
        Object.keys(restored.counts).length ||
      Object.entries(restored.counts).some(
        ([key, count]) =>
          value.counts[key as keyof typeof value.counts] !== count,
      )
    )
      throw new Error();
    return restored;
  } catch {
    // Keep corrupt data in storage for explicit user action, without leaking its
    // content through a parser error or silently pretending no draft existed.
    throw new Error("owner_invalid_data");
  }
}
