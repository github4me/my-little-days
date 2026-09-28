// A synchronous admission barrier plus a drainable queue. The root coordinator
// blocks writes before create/join, drains old writes, then reviews the source.
// Maintenance cleanup bypasses admission but still waits for earlier writes.
let blocked = false;
let tail: Promise<unknown> = Promise.resolve();
let reminderTail: Promise<unknown> = Promise.resolve();

export function personalStorageIsBlocked(): boolean {
  return blocked;
}

// Native scheduling must finish BEFORE final cancel/dismiss during activation.
// A separate queue avoids deadlocks when reminder work saves SQLite settings.
export function reminderWrite<T>(operation: () => Promise<T>): Promise<T> {
  if (blocked)
    return Promise.reject(
      new Error("Personal reminders are locked during family sharing."),
    );
  const pending = reminderTail.then(() => {
    if (blocked)
      throw new Error("Personal reminders are locked during family sharing.");
    return operation();
  });
  reminderTail = pending.catch(() => undefined);
  return pending;
}

export async function drainReminderWrites(): Promise<void> {
  await reminderTail;
}

export function setPersonalStorageBlocked(value: boolean): void {
  blocked = value;
}

export async function drainPersonalStorageWrites(): Promise<void> {
  await tail;
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const pending = tail.then(operation);
  tail = pending.catch(() => undefined);
  return pending;
}

export function personalWrite<T>(operation: () => Promise<T>): Promise<T> {
  if (blocked)
    return Promise.reject(
      new Error("Personal storage is locked during family sharing."),
    );
  return enqueue(operation);
}

export function personalMaintenance<T>(
  operation: () => Promise<T>,
): Promise<T> {
  blocked = true;
  return enqueue(operation);
}
