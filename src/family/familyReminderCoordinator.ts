import type { FamilyReminderPlan } from "./familyReminderPlan";

export type FamilyReminderPreferences = { origin: string; enabled: boolean };
export type FamilyReminderCleanup = { clearPreference: boolean };
export type ScheduledFamilyReminder = {
  id: string;
  origin: string;
  fingerprint: string;
};
type Dependencies = {
  load(): Promise<FamilyReminderPreferences | null>;
  save(value: FamilyReminderPreferences | null): Promise<void>;
  loadCleanup(): Promise<FamilyReminderCleanup | null>;
  saveCleanup(value: FamilyReminderCleanup | null): Promise<void>;
  requestPermission(): Promise<void>;
  list(): Promise<ScheduledFamilyReminder[]>;
  schedule(origin: string, plan: FamilyReminderPlan): Promise<string>;
  cancel(id: string): Promise<void>;
  dismiss(): Promise<void>;
};

// One native scheduling queue, independent from the blocked personal write
// queue. Revocation invalidates admission synchronously, before any await.
export class FamilyReminderCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private origin: string | null = null;
  private enabled = false;
  private startupCleanup = true;
  private cleanupPending: FamilyReminderCleanup | null = null;

  constructor(private readonly dependencies: Dependencies) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  shouldShow(origin: unknown): boolean {
    return this.enabled && typeof origin === "string" && this.origin === origin;
  }

  loadOptIn(origin: string): Promise<boolean> {
    return this.enqueue(async () => {
      await this.retryCleanup();
      const preference = await this.dependencies.load();
      return preference?.origin === origin && preference.enabled;
    });
  }

  private async cancelAll(): Promise<void> {
    const failures: unknown[] = [];
    let notifications: ScheduledFamilyReminder[] = [];
    try {
      notifications = await this.dependencies.list();
    } catch (cause) {
      failures.push(cause);
    }
    for (const notification of notifications) {
      try {
        await this.dependencies.cancel(notification.id);
      } catch (cause) {
        failures.push(cause);
      }
    }
    try {
      await this.dependencies.dismiss();
    } catch (cause) {
      failures.push(cause);
    }
    if (failures.length) throw new Error("reminder_cleanup_failed");
  }

  private async cleanup(clearPreference = false): Promise<void> {
    this.enabled = false;
    const failures: unknown[] = [];
    let pending = {
      clearPreference:
        clearPreference || !!this.cleanupPending?.clearPreference,
    };
    this.cleanupPending = pending;
    try {
      const stored = await this.dependencies.loadCleanup();
      pending = {
        clearPreference: pending.clearPreference || !!stored?.clearPreference,
      };
      this.cleanupPending = pending;
    } catch (cause) {
      // A previously unreadable journal may contain a stronger clear request.
      // Never overwrite that unknown intent with a weaker suspension.
      pending = { clearPreference: true };
      this.cleanupPending = pending;
      failures.push(cause);
    }
    // Journal and preference writes must never prevent native cleanup attempts.
    try {
      await this.dependencies.saveCleanup(pending);
    } catch (cause) {
      failures.push(cause);
    }
    if (pending.clearPreference) {
      try {
        await this.dependencies.save(null);
      } catch (cause) {
        failures.push(cause);
      }
    }
    try {
      await this.cancelAll();
    } catch (cause) {
      failures.push(cause);
    }
    if (!failures.length) {
      try {
        await this.dependencies.saveCleanup(null);
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (failures.length) throw new Error("reminder_cleanup_failed");
    this.cleanupPending = null;
    this.startupCleanup = false;
  }

  private async retryCleanup(): Promise<void> {
    // Reconcile on every process start too: an unavailable disk may have
    // prevented the previous process from writing its retry journal.
    if (this.startupCleanup || this.cleanupPending) await this.cleanup();
  }

  setOptIn(origin: string, enabled: boolean): Promise<void> {
    const generation = ++this.generation;
    this.origin = origin;
    this.enabled = false;
    return this.enqueue(async () => {
      if (generation !== this.generation) return;
      await this.cleanup();
      if (generation !== this.generation) return;
      await this.dependencies.save({ origin, enabled: false });
      if (!enabled || generation !== this.generation) return;
      await this.dependencies.requestPermission();
      if (generation !== this.generation) return;
      await this.dependencies.save({ origin, enabled: true });
      if (generation === this.generation) this.enabled = true;
    });
  }

  sync(origin: string, plans: readonly FamilyReminderPlan[]): Promise<void> {
    if (this.origin !== origin) {
      ++this.generation;
      this.enabled = false;
    }
    const generation = this.generation;
    this.origin = origin;
    return this.enqueue(async () => {
      if (generation !== this.generation) return;
      this.enabled = false;
      await this.retryCleanup();
      try {
        const preference = await this.dependencies.load();
        if (generation !== this.generation) return;
        if (preference?.origin !== origin || !preference.enabled) {
          await this.cleanup();
          if (generation === this.generation && preference?.origin !== origin)
            await this.dependencies.save({ origin, enabled: false });
          return;
        }
        const scheduled = await this.dependencies.list();
        const wanted = new Set(plans.map((plan) => plan.fingerprint));
        const existing = new Set<string>();
        for (const notification of scheduled) {
          if (
            notification.origin === origin &&
            wanted.has(notification.fingerprint) &&
            !existing.has(notification.fingerprint)
          )
            existing.add(notification.fingerprint);
          else await this.dependencies.cancel(notification.id);
          if (generation !== this.generation) return;
        }
        for (const plan of plans) {
          if (generation !== this.generation) return;
          if (existing.has(plan.fingerprint)) continue;
          const id = await this.dependencies.schedule(origin, plan);
          if (generation !== this.generation) {
            await this.dependencies.cancel(id);
            return;
          }
          existing.add(plan.fingerprint);
        }
        if (generation === this.generation) this.enabled = true;
      } catch (cause) {
        await this.cleanup();
        throw cause;
      }
    });
  }

  suspend(): Promise<void> {
    ++this.generation;
    this.origin = null;
    this.enabled = false;
    return this.enqueue(() => this.cleanup());
  }

  clear(): Promise<void> {
    ++this.generation;
    this.origin = null;
    this.enabled = false;
    return this.enqueue(() => this.cleanup(true));
  }
}
