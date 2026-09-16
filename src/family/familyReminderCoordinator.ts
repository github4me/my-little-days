import type { FamilyReminderPlan } from "./familyReminderPlan";

export type FamilyReminderPreferences = { origin: string; enabled: boolean };
export type ScheduledFamilyReminder = {
  id: string;
  origin: string;
  fingerprint: string;
};
type Dependencies = {
  load(): Promise<FamilyReminderPreferences | null>;
  save(value: FamilyReminderPreferences | null): Promise<void>;
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
      const preference = await this.dependencies.load();
      return preference?.origin === origin && preference.enabled;
    });
  }

  private async cancelAll(): Promise<void> {
    for (const notification of await this.dependencies.list())
      await this.dependencies.cancel(notification.id);
    await this.dependencies.dismiss();
  }

  setOptIn(origin: string, enabled: boolean): Promise<void> {
    const generation = ++this.generation;
    this.origin = origin;
    this.enabled = false;
    return this.enqueue(async () => {
      if (generation !== this.generation) return;
      await this.dependencies.save({ origin, enabled: false });
      await this.cancelAll();
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
      const preference = await this.dependencies.load();
      if (generation !== this.generation) return;
      this.enabled = preference?.origin === origin && preference.enabled;
      if (!this.enabled) {
        await this.cancelAll();
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
    });
  }

  suspend(): Promise<void> {
    ++this.generation;
    this.origin = null;
    this.enabled = false;
    return this.enqueue(() => this.cancelAll());
  }

  clear(): Promise<void> {
    ++this.generation;
    this.origin = null;
    this.enabled = false;
    return this.enqueue(async () => {
      await this.dependencies.save(null);
      await this.cancelAll();
    });
  }
}
