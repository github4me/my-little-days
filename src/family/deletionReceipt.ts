import type { DeletionReceipt } from "./deletionReceiptTypes";
export type { DeletionReceipt } from "./deletionReceiptTypes";

// Browser sign-in/deletion is deliberately not part of the native invitation pilot.
export async function loadDeletionReceipt(): Promise<DeletionReceipt | null> {
  return null;
}
export async function saveDeletionReceipt(
  _value: DeletionReceipt,
): Promise<void> {
  throw new Error("native_required");
}
export async function clearDeletionReceipt(): Promise<void> {}
