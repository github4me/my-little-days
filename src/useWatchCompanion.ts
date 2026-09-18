import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import {
  acknowledgeWatchCommand,
  listenForWatchCommands,
  pendingWatchCommands,
  publishWatchContext,
  watchBridgeAvailable,
  watchAccessEpoch,
  suspendWatchContext,
} from "./watchBridge";
import {
  parseWatchCommand,
  watchReceipt,
  type WatchCommand,
  type WatchContext,
  type WatchReceipt,
} from "./watchProtocol";

type Options = {
  changeToken: string;
  context(): Promise<WatchContext | null>;
  apply(command: WatchCommand): Promise<WatchReceipt>;
  receipts(): WatchReceipt[];
};
const retryable = new Set([
  "action_busy",
  "refresh_required",
  "transition_pending",
  "local_save_failed",
  "watch_dependency_pending",
  "watch_recording_unavailable",
  "session_changed",
]);

// Native reception survives a missing React runtime. This hook only consumes
// durable commands while the current, authorized app workspace is available.
export function useWatchCompanion(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const running = useRef(false);
  const again = useRef(false);
  const sent = useRef(new Map<string, string>());
  const startup = useRef<Promise<void> | null>(null);
  const run = useRef<() => Promise<void>>(async () => {});
  run.current = async () => {
    if (!watchBridgeAvailable) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      // Until local identity restoration finishes, pause persisted native
      // content rather than re-publishing an old grant or renewing its lease.
      startup.current ??= suspendWatchContext().catch((cause) => {
        startup.current = null;
        throw cause;
      });
      await startup.current;
      const accessEpoch = watchAccessEpoch();
      const draft = await latest.current.context();
      if (!draft) return;
      let context = await publishWatchContext(draft, accessEpoch);
      if (!context) return;
      const ack = async (receipt: WatchReceipt) => {
        const key = JSON.stringify(receipt);
        if (sent.current.get(receipt.commandId) === key) return;
        await acknowledgeWatchCommand(receipt);
        sent.current.set(receipt.commandId, key);
      };
      const commands =
        AppState.currentState === "active" ? await pendingWatchCommands() : [];
      for (const raw of commands) {
        let command: WatchCommand;
        try {
          command = parseWatchCommand(raw);
        } catch {
          // Native transport has already checked these routing fields. Invalid
          // domain data needs a durable rejection, not an endlessly retried item.
          try {
            await ack(
              watchReceipt(
                JSON.parse(raw) as WatchCommand,
                "rejected",
                "invalid_watch_command",
              ),
            );
          } catch {}
          continue;
        }
        if (
          command.workspaceKey !== context.workspaceKey ||
          command.generation !== context.generation ||
          command.bridgeId !== context.bridgeId
        ) {
          await ack(watchReceipt(command, "rejected", "membership_changed"));
          continue;
        }
        if (
          context.status !== "ready" ||
          Date.parse(context.expiresAt) <= Date.now()
        )
          continue;
        try {
          const receipt = await latest.current.apply(command);
          // Publish the app's committed projection before the receipt that lets
          // the Watch retire its overlay; transport receipt alone never does.
          const nextEpoch = watchAccessEpoch();
          const refreshed = await latest.current.context();
          if (refreshed)
            context =
              (await publishWatchContext(refreshed, nextEpoch)) ?? context;
          await ack(receipt);
        } catch (cause) {
          const code =
            cause instanceof Error ? cause.message : "local_save_failed";
          if (!retryable.has(code))
            await ack(
              watchReceipt(
                command,
                "rejected",
                /^[a-z_]+$/.test(code) ? code : "invalid_watch_command",
              ),
            );
        }
      }
      for (const receipt of latest.current.receipts()) {
        if (
          receipt.workspaceKey === context.workspaceKey &&
          receipt.generation === context.generation &&
          receipt.bridgeId === context.bridgeId
        )
          await ack(receipt);
      }
    } catch {
      // A native/SQLite failure leaves the durable inbox untouched. Retry on the
      // next foreground/event tick; never turn transport failure into success.
    } finally {
      running.current = false;
      if (again.current) {
        again.current = false;
        void run.current();
      }
    }
  };
  useEffect(() => {
    if (!watchBridgeAvailable) return;
    const subscription = listenForWatchCommands(() => {
      void run.current();
    });
    const foreground = AppState.addEventListener("change", (value) => {
      if (value === "active") void run.current();
    });
    const timer = setInterval(() => {
      void run.current();
    }, 30000);
    void run.current();
    return () => {
      subscription?.remove();
      foreground.remove();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    void run.current();
  }, [options.changeToken]);
}
