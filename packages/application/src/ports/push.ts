import type { MemberId } from "@weekly-planner/domain";

/** A browser's address for pushing a message to one installed app (what `PushSubscription.toJSON()` holds). */
export interface PushSubscription {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/** Port: where each member's phones can be reached. */
export interface PushSubscriptions {
  /** One row per endpoint: a phone that subscribes again, as another member, belongs to the new one. */
  save(member: MemberId, subscription: PushSubscription): Promise<void>;
  remove(endpoint: string): Promise<void>;
  all(): Promise<readonly { readonly member: MemberId; readonly subscription: PushSubscription }[]>;
}
