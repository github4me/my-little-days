import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import type { WatchContext, WatchReceipt } from "./watchProtocol";

type Bridge = {
  getPendingCommands(): Promise<string[]>;
  publishContext(json: string): Promise<string>;
  acknowledgeCommand(json: string): Promise<void>;
  suspendContext(): Promise<void>;
  invalidateContext(): Promise<void>;
  addListener(
    name: "commandReceived",
    listener: () => void,
  ): { remove(): void };
};
const bridge =
  Platform.OS === "ios"
    ? requireOptionalNativeModule<Bridge>("LittleDaysWatchBridge")
    : null;
export const watchBridgeAvailable = !!bridge;
let accessEpoch = 0;
export const watchAccessEpoch = () => accessEpoch;
export const pendingWatchCommands = async () =>
  bridge ? bridge.getPendingCommands() : [];
export async function suspendWatchContext() {
  accessEpoch++;
  await bridge?.suspendContext();
}
export async function invalidateWatchContext() {
  accessEpoch++;
  await bridge?.invalidateContext();
}
export async function publishWatchContext(
  context: WatchContext,
  expectedEpoch = accessEpoch,
): Promise<WatchContext | null> {
  if (!bridge || expectedEpoch !== accessEpoch) return null;
  return JSON.parse(
    await bridge.publishContext(JSON.stringify(context)),
  ) as WatchContext;
}
export async function acknowledgeWatchCommand(receipt: WatchReceipt) {
  await bridge?.acknowledgeCommand(JSON.stringify(receipt));
}
export function listenForWatchCommands(listener: () => void) {
  return bridge?.addListener("commandReceived", listener);
}
