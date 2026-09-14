import * as SQLite from "expo-sqlite";
import { parseStoredPilot, type PilotState } from "./pilotState";
import type { OwnerSeedDraft } from "./ownerSeed";
import {
  parseStoredOwnerSetup,
  serializeOwnerSetupDraft,
} from "./ownerSetupDraft";
let database: Promise<SQLite.SQLiteDatabase> | undefined;
let operations: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.catch(() => {});
  return result;
}
const db = () =>
  (database ??= (async () => {
    const d = await SQLite.openDatabaseAsync("little-days-family-pilot.db");
    await d.execAsync(
      "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS pilot_accounts (account_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS owner_setup_drafts (account_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);",
    );
    return d;
  })());
export async function loadPilot(accountId: string): Promise<PilotState> {
  return serialized(async () => {
    const row = await (
      await db()
    ).getFirstAsync<{ payload: string }>(
      "SELECT payload FROM pilot_accounts WHERE account_id = ?",
      accountId,
    );
    return parseStoredPilot(row?.payload ?? null);
  });
}
export async function savePilot(
  accountId: string,
  state: PilotState,
  options?: { discardOwnerSetup?: boolean },
): Promise<void> {
  const payload = JSON.stringify(state);
  return serialized(async () => {
    await (
      await db()
    ).withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        "INSERT OR REPLACE INTO pilot_accounts(account_id, payload) VALUES (?, ?)",
        accountId,
        payload,
      );
      if (options?.discardOwnerSetup)
        await tx.runAsync(
          "DELETE FROM owner_setup_drafts WHERE account_id = ?",
          accountId,
        );
    });
  });
}
export async function clearPilot(accountId: string): Promise<void> {
  return serialized(async () => {
    await (
      await db()
    ).withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        "DELETE FROM pilot_accounts WHERE account_id = ?",
        accountId,
      );
      await tx.runAsync(
        "DELETE FROM owner_setup_drafts WHERE account_id = ?",
        accountId,
      );
    });
  });
}
export async function loadOwnerSetup(
  accountKey: string,
  ownEmail: string,
): Promise<OwnerSeedDraft | null> {
  return serialized(async () => {
    const row = await (
      await db()
    ).getFirstAsync<{ payload: string }>(
      "SELECT payload FROM owner_setup_drafts WHERE account_id = ?",
      accountKey,
    );
    return parseStoredOwnerSetup(row?.payload ?? null, ownEmail);
  });
}
export async function saveOwnerSetup(
  accountKey: string,
  draft: OwnerSeedDraft,
): Promise<void> {
  const payload = serializeOwnerSetupDraft(draft);
  return serialized(async () => {
    await (
      await db()
    ).withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        "INSERT OR REPLACE INTO owner_setup_drafts(account_id, payload) VALUES (?, ?)",
        accountKey,
        payload,
      );
    });
  });
}
export async function clearOwnerSetup(accountKey: string): Promise<void> {
  return serialized(async () => {
    await (
      await db()
    ).runAsync(
      "DELETE FROM owner_setup_drafts WHERE account_id = ?",
      accountKey,
    );
  });
}
