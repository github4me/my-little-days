import type { PushCategory, PushScope } from "./familyPushCore";
export type FamilyPushView = {
  supported: boolean;
  enabled: boolean;
  desiredEnabled: boolean;
  categories: PushCategory[];
  pending: boolean;
};
export const unsupportedPush: FamilyPushView = {
  supported: false,
  enabled: false,
  desiredEnabled: false,
  categories: ["feed", "diaper", "sleep"],
  pending: false,
};
export function setFamilyPushContext(_scope: PushScope | null) {}
export async function loadFamilyPush(): Promise<FamilyPushView> {
  return unsupportedPush;
}
export async function configureFamilyPush(
  _enabled: boolean,
  _categories: PushCategory[],
  _locale: "zh" | "en",
): Promise<FamilyPushView> {
  throw new Error("native_required");
}
export async function reconcileFamilyPush(
  _locale: "zh" | "en",
): Promise<FamilyPushView> {
  return unsupportedPush;
}
export async function prepareFamilyPushLogout(): Promise<void> {}
