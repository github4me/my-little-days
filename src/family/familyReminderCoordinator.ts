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
    if (this.cleanupPending) {
      await this.cleanup();
      return;
    }
    if (!this.startupCleanup) return;
    let stored: FamilyReminderCleanup | null;
    try {
      stored = await this.dependencies.loadCleanup();
    } catch {
      // An unreadable journal may contain a revocation. The cleanup path marks
      // the stronger intent and attempts every native cancellation.
      await this.cleanup();
      return;
    }
    if (stored) {
      this.cleanupPending = stored;
      await this.cleanup();
      return;
    }
    // A verified same-origin sync can retain its schedules across a clean app
    // restart. Presented family notifications are still dismissed; schedules
    // from any other origin are removed before replacement below.
    try {
      await this.dependencies.dismiss();
      this.startupCleanup = false;
    } catch {
      await this.cleanup();
    }
  }

  private async rollbackScheduled(ids: readonly string[]): Promise<void> {
    let failed = false;
    for (const id of ids)
      try {
        await this.dependencies.cancel(id);
      } catch {
        failed = true;
      }
    if (failed) throw new Error("reminder_schedule_rollback_failed");
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
      let scheduled: ScheduledFamilyReminder[];
      try {
        const preference = await this.dependencies.load();
        if (generation !== this.generation) return;
        if (preference?.origin !== origin || !preference.enabled) {
          await this.cleanup();
          if (generation === this.generation && preference?.origin !== origin)
            await this.dependencies.save({ origin, enabled: false });
          return;
        }
        scheduled = await this.dependencies.list();
      } catch (cause) {
        await this.cleanup();
        throw cause;
      }

      const wanted = new Set(plans.map((plan) => plan.fingerprint));
      const existing = new Set<string>();
      const obsolete: ScheduledFamilyReminder[] = [];
      try {
        for (const notification of scheduled) {
          // sync() is admitted only for the caller's verified family origin.
          // Remove stale schedules from every other account/family before any
          // fallible replacement work, while retaining safe same-origin plans.
          if (notification.origin !== origin) {
            await this.dependencies.cancel(notification.id);
            if (generation !== this.generation) return;
            continue;
          }
          if (
            wanted.has(notification.fingerprint) &&
            !existing.has(notification.fingerprint)
          )
            existing.add(notification.fingerprint);
          else obsolete.push(notification);
        }
      } catch (cause) {
        await this.cleanup();
        throw cause;
      }

      // Replacement is two-phase: keep every old schedule until all new
      // schedules exist, then remove the old set. A transient native failure
      // therefore cannot turn an opted-in reminder refresh into no reminder.
      const created: string[] = [];
      try {
        for (const plan of plans) {
          if (generation !== this.generation) break;
          if (existing.has(plan.fingerprint)) continue;
          const id = await this.dependencies.schedule(origin, plan);
          created.push(id);
          if (generation !== this.generation) break;
          existing.add(plan.fingerprint);
        }
      } catch (cause) {
        if (generation === this.generation) this.enabled = true;
        await this.rollbackScheduled(created);
        throw cause;
      }
      if (generation !== this.generation) {
        await this.rollbackScheduled(created);
        return;
      }

      try {
        for (const notification of obsolete) {
          await this.dependencies.cancel(notification.id);
          if (generation !== this.generation) return;
        }
        if (generation === this.generation) this.enabled = true;
      } catch (cause) {
        // Every desired same-origin schedule now exists. If removal of an old
        // same-origin schedule fails, retain the complete replacement set and
        // retry the obsolete cancellation on the next verified sync. A brief
        // duplicate is safer than cleanup deleting all valid reminders.
        if (generation === this.generation && wanted.size > 0) {
          this.enabled = true;
          throw cause;
        }
        // With no desired schedule (or after context invalidation), this is a
        // revocation/deletion path and must keep durable fail-closed cleanup.
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
