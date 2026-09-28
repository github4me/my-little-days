export type DeletionReceipt = {
  apiUrl: string;
  deletionId: string;
  receiptSecret: string;
  status: "pending" | "awaiting_identity_deletion" | "completed";
  requestedAt: string;
};

export function parseDeletionReceipt(
  raw: string | null,
  apiUrl: string | undefined,
): DeletionReceipt | null {
  if (!raw || !apiUrl) return null;
  try {
    const value = JSON.parse(raw) as DeletionReceipt;
    if (
      value.apiUrl !== apiUrl ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value.deletionId,
      ) ||
      !/^[0-9a-f]{64}$/.test(value.receiptSecret) ||
      !["pending", "awaiting_identity_deletion", "completed"].includes(
        value.status,
      ) ||
      typeof value.requestedAt !== "string" ||
      !Number.isFinite(Date.parse(value.requestedAt))
    )
      return null;
    // Do not carry any extra account/family fields through the receipt store.
    return {
      apiUrl: value.apiUrl,
      deletionId: value.deletionId,
      receiptSecret: value.receiptSecret,
      status: value.status,
      requestedAt: value.requestedAt,
    };
  } catch {
    return null;
  }
}
