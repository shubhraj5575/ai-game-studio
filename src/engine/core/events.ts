/**
 * Minimal typed pub/sub event bus.
 * Used for gameplay feedback events (hit, kill, pickup...) that the
 * presentation layer subscribes to, and for the studio's own telemetry.
 */

export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Array<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    let list = this.handlers.get(type);
    if (!list) {
      list = [];
      this.handlers.set(type, list);
    }
    list.push(fn as (payload: never) => void);
    return () => this.off(type, fn);
  }

  off<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): void {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn as (payload: never) => void);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.handlers.get(type);
    if (!list) return;
    // Copy: handlers may subscribe/unsubscribe during dispatch.
    for (const fn of list.slice()) fn(payload as never);
  }

  clear(): void {
    this.handlers.clear();
  }
}
