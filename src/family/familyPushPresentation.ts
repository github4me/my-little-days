import {
  allowsFamilyEntryPush,
  allowsFamilyEntryPushOpen,
  type PushRegistration,
  type PushScope,
} from "./familyPushCore";
let scope: PushScope | null = null;
let registration: PushRegistration | null = null;
let suspended = false;
export function setFamilyPushPresentation(
  nextScope: PushScope | null,
  nextRegistration: PushRegistration | null,
  nextSuspended = false,
) {
  scope = nextScope;
  registration = nextRegistration;
  suspended = nextSuspended;
}
export function shouldShowFamilyEntryPush(data: unknown) {
  return !suspended && allowsFamilyEntryPush(data, scope, registration);
}
export function canOpenFamilyEntryPush(data: unknown) {
  return allowsFamilyEntryPushOpen(data, scope, registration);
}
