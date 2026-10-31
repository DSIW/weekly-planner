import { describe, expect, it } from "vitest";
import { memberId } from "@weekly-planner/domain";
import { type CredentialCheck, type HouseholdDirectory, SignIn } from "../src/index.js";

const directory = (check: CredentialCheck): HouseholdDirectory & { seen: string[][] } => {
  const seen: string[][] = [];
  return {
    seen,
    checkCredentials: async (u, p) => {
      seen.push([u, p]);
      return check;
    },
  };
};

describe("SignIn", () => {
  it("returns the member when the directory accepts the credentials", async () => {
    const member = { id: memberId("2"), name: "Max" };
    const d = directory({ kind: "ok", member });
    expect(await new SignIn(d).execute({ username: " dsiw ", password: "pw" })).toEqual({ ok: true, value: member });
    expect(d.seen).toEqual([["dsiw", "pw"]]);
  });

  it("rejects wrong credentials and users outside the household with their own reason", async () => {
    expect(
      await new SignIn(directory({ kind: "invalid_credentials" })).execute({ username: "a", password: "b" }),
    ).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await new SignIn(directory({ kind: "not_in_household" })).execute({ username: "a", password: "b" })).toEqual(
      { ok: false, reason: "not_in_household" },
    );
  });

  it("does not ask the directory when username or password is empty", async () => {
    const d = directory({ kind: "invalid_credentials" });
    expect(await new SignIn(d).execute({ username: "  ", password: "x" })).toEqual({
      ok: false,
      reason: "missing_credentials",
    });
    expect(await new SignIn(d).execute({ username: "a", password: "" })).toEqual({
      ok: false,
      reason: "missing_credentials",
    });
    expect(d.seen).toEqual([]);
  });
});
