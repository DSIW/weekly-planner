import type { DomainEvent, EventPublisher } from "@weekly-planner/application";

type Listener = (event: DomainEvent) => void;

/** Adapter: the events of committed changes reach every connected client of this process (Server-Sent Events). */
export class InProcessEventHub implements EventPublisher {
  private readonly listeners = new Set<Listener>();

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      for (const listener of [...this.listeners]) {
        try {
          listener(event);
        } catch {
          // A broken connection must not stop the others or fail the command that was already committed.
        }
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
