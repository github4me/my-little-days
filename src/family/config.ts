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
