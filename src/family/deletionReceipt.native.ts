import * as SecureStore from "expo-secure-store";
import { familyConfig } from "./config";
import {
  parseDeletionReceipt,
  type DeletionReceipt,
} from "./deletionReceiptTypes";
export type { DeletionReceipt } from "./deletionReceiptTypes";

// Status-only receipt survives logout, without retaining identity or family data.
const key = "my-little-days.family-pilot.deletion-receipt";
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
let mutations: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const result = mutations.then(task);
  mutations = result.catch(() => {});
  return result;
}
export function loadDeletionReceipt(): Promise<DeletionReceipt | null> {
  return serialized(async () =>
    parseDeletionReceipt(
      await SecureStore.getItemAsync(key, options),
      familyConfig?.apiUrl,
    ),
  );
}
export function saveDeletionReceipt(value: DeletionReceipt): Promise<void> {
  const receipt = parseDeletionReceipt(
    JSON.stringify(value),
    familyConfig?.apiUrl,
  );
  if (!receipt) return Promise.reject(new Error("invalid_deletion_receipt"));
  return serialized(() =>
    SecureStore.setItemAsync(key, JSON.stringify(receipt), options),
  );
}
export function clearDeletionReceipt(): Promise<void> {
  return serialized(() => SecureStore.deleteItemAsync(key, options));
}
