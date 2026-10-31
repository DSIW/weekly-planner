import { reject, succeed, type Result } from "@weekly-planner/domain";
import type { HouseholdDirectory, Member } from "../ports/household-directory.js";

/** Only members of the household may use the planner; their accounts live in KitchenOwl. */
export class SignIn {
  constructor(private readonly directory: HouseholdDirectory) {}

  async execute(cmd: { username: string; password: string }): Promise<Result<Member>> {
    if (cmd.username.trim() === "" || cmd.password === "") return reject("missing_credentials");
    const check = await this.directory.checkCredentials(cmd.username.trim(), cmd.password);
    return check.kind === "ok" ? succeed(check.member) : reject(check.kind);
  }
}
