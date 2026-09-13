// Shared API is implemented natively. Never put OAuth tokens in browser storage.
import type { PilotIdentity } from "./identity";
export async function signIn(_emailHint?: string): Promise<void> {
  throw new Error("native_required");
}
export async function signOut(): Promise<void> {}
export async function hasSession(): Promise<boolean> {
  return false;
}
export async function getAccessToken(): Promise<string> {
  throw new Error("native_required");
}
export async function loadIdentity(): Promise<PilotIdentity | null> {
  return null;
}
export async function saveIdentity(_identity: PilotIdentity): Promise<void> {
  throw new Error("native_required");
}
