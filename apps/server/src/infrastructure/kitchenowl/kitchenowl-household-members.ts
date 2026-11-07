import type { HouseholdMembers, MemberProfile } from "@weekly-planner/application";
import { memberId, type MemberId } from "@weekly-planner/domain";
import type { KitchenOwlClient } from "./client.js";

/** How long the member list is remembered: names and pictures hardly ever change, and every idea list asks. */
const REMEMBER_MS = 10 * 60_000;

/**
 * Adapter: the household's members and their own pictures from KitchenOwl (the household's `member` list carries each
 * member's `photo`, a file name under `/upload`). A picture is only fetched for a member of the household, by the file
 * name KitchenOwl gave, never by a name a client chose.
 */
export class KitchenOwlHouseholdMembers implements HouseholdMembers {
  private remembered: { at: number; members: readonly { profile: MemberProfile; file: string | null }[] } | null = null;

  constructor(
    private readonly client: Pick<KitchenOwlClient, "householdMembers" | "fetchPhoto">,
    private readonly now: () => number = Date.now,
  ) {}

  private async members() {
    if (this.remembered && this.now() - this.remembered.at < REMEMBER_MS) return this.remembered.members;
    const members = (await this.client.householdMembers()).map((m) => ({
      profile: { id: memberId(String(m.id)), name: m.name, avatar: m.photo } satisfies MemberProfile,
      file: m.photo,
    }));
    this.remembered = { at: this.now(), members };
    return members;
  }

  async list(): Promise<readonly MemberProfile[]> {
    return (await this.members()).map((m) => m.profile);
  }

  async avatar(id: MemberId) {
    const file = (await this.members()).find((m) => m.profile.id === id)?.file;
    if (!file) return null;
    const photo = await this.client.fetchPhoto(file);
    return photo?.contentType.startsWith("image/") ? photo : null;
  }
}
