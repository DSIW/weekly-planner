import type { MemberId } from "@weekly-planner/domain";
import type { PushSubscription, PushSubscriptions } from "../ports/push.js";

/** A member turns notifications on for this phone. Subscribing again with the same address changes nothing. */
export class SubscribeToPush {
  constructor(private readonly subscriptions: Pick<PushSubscriptions, "save">) {}

  execute(cmd: { member: MemberId; subscription: PushSubscription }): Promise<void> {
    return this.subscriptions.save(cmd.member, cmd.subscription);
  }
}

/** A member turns notifications off for this phone. */
export class UnsubscribeFromPush {
  constructor(private readonly subscriptions: Pick<PushSubscriptions, "remove">) {}

  execute(cmd: { endpoint: string }): Promise<void> {
    return this.subscriptions.remove(cmd.endpoint);
  }
}
