import type { CredentialCheck, HouseholdDirectory } from "@weekly-planner/application";
import { memberId } from "@weekly-planner/domain";
import type { KitchenOwlClient } from "./client.js";

/**
 * Adapter: implements the HouseholdDirectory port on top of KitchenOwl.
 * A person signs in with their own KitchenOwl account and must be a member of the configured household.
 */
export class KitchenOwlHouseholdDirectory implements HouseholdDirectory {
  constructor(private readonly client: Pick<KitchenOwlClient, "authenticate" | "currentUser" | "householdMemberIds">) {}

  async checkCredentials(username: string, password: string): Promise<CredentialCheck> {
    const token = await this.client.authenticate(username, password);
    if (token === null) return { kind: "invalid_credentials" };
    const user = await this.client.currentUser(token);
    if (!(await this.client.householdMemberIds()).includes(user.id)) return { kind: "not_in_household" };
    return { kind: "ok", member: { id: memberId(String(user.id)), name: user.name } };
  }
}
