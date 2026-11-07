import type { MemberId } from "@weekly-planner/domain";

export interface Member {
  readonly id: MemberId;
  readonly name: string;
}

export type CredentialCheck =
  | { readonly kind: "ok"; readonly member: Member }
  | { readonly kind: "invalid_credentials" }
  | { readonly kind: "not_in_household" };

/** Port: who the household members are and whether someone may sign in. Implemented against KitchenOwl. */
export interface HouseholdDirectory {
  checkCredentials(username: string, password: string): Promise<CredentialCheck>;
}

/** A household member as the lists show them. */
export interface MemberProfile {
  readonly id: MemberId;
  readonly name: string;
  /** Identifies the member's own picture (it changes when the picture does); null when they have none. */
  readonly avatar: string | null;
}

/** Port: the household's members with their pictures, for showing who did something. Implemented against KitchenOwl. */
export interface HouseholdMembers {
  list(): Promise<readonly MemberProfile[]>;
  /** The member's own picture; null when they have none. */
  avatar(id: MemberId): Promise<{ contentType: string; data: Uint8Array } | null>;
}
