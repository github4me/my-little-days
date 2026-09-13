export type FamilyConfig = {
  apiUrl: string;
  tenantId: string;
  clientId: string;
  scope: string;
  authority: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseFamilyConfig(values: {
  apiUrl?: string;
  tenantId?: string;
  clientId?: string;
  scope?: string;
}): FamilyConfig | null {
  try {
    const { tenantId = "", clientId = "", scope = "" } = values;
    const url = new URL(values.apiUrl ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/"].includes(url.pathname) ||
      !uuid.test(tenantId) ||
      !uuid.test(clientId) ||
      !/^api:\/\/[0-9a-f-]{36}\/Family\.ReadWrite$/i.test(scope) ||
      !uuid.test(scope.slice(6).split("/")[0])
    )
      return null;
    return {
      apiUrl: url.origin,
      tenantId,
      clientId,
      scope,
      authority: `https://${tenantId}.ciamlogin.com/${tenantId}/v2.0`,
    };
  } catch {
    return null;
  }
}
// Expo statically replaces these public values at bundle time. Never add secrets.
export const familyConfig = parseFamilyConfig({
  apiUrl: process.env.EXPO_PUBLIC_FAMILY_API_URL,
  tenantId: process.env.EXPO_PUBLIC_ENTRA_TENANT_ID,
  clientId: process.env.EXPO_PUBLIC_ENTRA_CLIENT_ID,
  scope: process.env.EXPO_PUBLIC_ENTRA_API_SCOPE,
});

export function parseInviteToken(value: string, apiUrl: string): string {
  let token = value.trim();
  if (token.includes("://")) {
    const url = new URL(token);
    const validWeb = url.origin === apiUrl && url.pathname === "/join";
    const validApp =
      url.protocol === "mylittledays:" && url.hostname === "family-invite";
    if ((!validWeb && !validApp) || url.username || url.password || url.search)
      throw new Error("invalid_invitation");
    token = new URLSearchParams(url.hash.slice(1)).get("token") ?? "";
  }
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token))
    throw new Error("invalid_invitation");
  return token;
}
