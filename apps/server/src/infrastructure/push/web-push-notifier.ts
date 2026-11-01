import type { Notifier, PushSubscription, PushSubscriptions } from "@weekly-planner/application";
import type { MemberId, PlanningSession } from "@weekly-planner/domain";

/** Sends one message to one phone. Rejects with a `statusCode` when the push service answers with an error. */
type PushSender = (subscription: PushSubscription, payload: string) => Promise<unknown>;

/** The push service says the phone is gone for good: the app was removed or notifications were switched off. */
const GONE = new Set([404, 410]);

/**
 * Adapter: tells every subscribed phone that a plan is waiting. It never throws: a phone that cannot be reached must
 * not keep the others from hearing, and the board shows the same reminder when the app is opened.
 */
export class WebPushNotifier implements Notifier {
  constructor(
    private readonly subscriptions: Pick<PushSubscriptions, "all" | "remove">,
    private readonly send: PushSender,
    private readonly appUrl: string,
    private readonly log: (line: string) => void = console.error,
  ) {}

  async finalizeReminder(_session: PlanningSession): Promise<void> {
    await this.deliver(
      (await this.subscriptions.all()).map((r) => r.subscription),
      "Ihr habt Tage geplant, aber die Einkaufsliste ist noch nicht gefüllt.",
    );
  }

  async test(member: MemberId): Promise<number> {
    const phones = (await this.subscriptions.all()).filter((r) => r.member === member).map((r) => r.subscription);
    return this.deliver(phones, "Benachrichtigungen sind an. So meldet sich der Wochenplan.");
  }

  /** Sends the message to each phone; returns how many took it. */
  private async deliver(phones: readonly PushSubscription[], body: string): Promise<number> {
    const payload = JSON.stringify({ title: "Wochenplan", body, url: this.appUrl });
    let reached = 0;
    for (const subscription of phones) {
      try {
        await this.send(subscription, payload);
        reached++;
      } catch (error) {
        const status = (error as { statusCode?: unknown } | null)?.statusCode;
        if (typeof status === "number" && GONE.has(status)) await this.subscriptions.remove(subscription.endpoint);
        else this.log(`push to a phone failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return reached;
  }
}
