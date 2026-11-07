import type { MemberId } from "@weekly-planner/domain";
import type { HouseholdMembers, MemberProfile } from "../ports/household-directory.js";

/**
 * The household's members, to put a name and a picture to the id a list keeps. Never fails: when the directory cannot
 * be reached the list is empty and the caller shows a neutral name, because a missing picture must not hide the list.
 */
export class ListMembers {
  constructor(private readonly deps: { members: HouseholdMembers }) {}

  async execute(): Promise<readonly MemberProfile[]> {
    return this.deps.members.list().catch(() => []);
  }
}

/** A member's own picture, as KitchenOwl keeps it. */
export class GetMemberAvatar {
  constructor(private readonly deps: { members: HouseholdMembers }) {}

  execute(cmd: { member: MemberId }): Promise<{ contentType: string; data: Uint8Array } | null> {
    return this.deps.members.avatar(cmd.member);
  }
}
