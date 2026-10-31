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
