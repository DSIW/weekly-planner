import { describe, expect, it } from "vitest";
import { KitchenOwlClient } from "../../src/infrastructure/kitchenowl/client.js";
import { KitchenOwlHouseholdDirectory } from "../../src/infrastructure/kitchenowl/kitchenowl-household-directory.js";

const cfg = { kitchenowlUrl: "https://ko.test", kitchenowlToken: "service", householdId: 2 };

/** A KitchenOwl that knows one user and a household with the given members. */
function fakeKitchenOwl(members: number[]) {
  const calls: { method: string; path: string; auth: string | null; body?: unknown }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace("https://ko.test/api", "");
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("Authorization");
    calls.push({ method, path, auth, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "/auth") {
      const { password } = JSON.parse(String(init?.body));
      return password === "right"
        ? new Response(JSON.stringify({ access_token: "user-token", refresh_token: "r" }))
        : new Response("{}", { status: 401 });
    }
    if (path === "/user") return new Response(JSON.stringify({ id: 3, name: "AC", username: "ac", extra: 1 }));
    if (path === "/household/2")
      return new Response(JSON.stringify({ member: members.map((id) => ({ id, name: "x" })) }));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { directory: new KitchenOwlHouseholdDirectory(new KitchenOwlClient(cfg, fetchImpl)), calls };
}

describe("KitchenOwlHouseholdDirectory", () => {
  it("accepts a household member and returns their id and name", async () => {
    const { directory, calls } = fakeKitchenOwl([2, 3]);
    expect(await directory.checkCredentials("ac", "right")).toEqual({ kind: "ok", member: { id: "3", name: "AC" } });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/auth", body: { username: "ac", password: "right" } });
    expect(calls[1]).toMatchObject({ path: "/user", auth: "Bearer user-token" });
    expect(calls[2]).toMatchObject({ path: "/household/2", auth: "Bearer service" });
  });

  it("rejects wrong credentials without asking for the user or the household", async () => {
    const { directory, calls } = fakeKitchenOwl([2, 3]);
    expect(await directory.checkCredentials("ac", "wrong")).toEqual({ kind: "invalid_credentials" });
    expect(calls).toHaveLength(1);
  });

  it("rejects a KitchenOwl user who is not in the household", async () => {
    const { directory } = fakeKitchenOwl([2]);
    expect(await directory.checkCredentials("ac", "right")).toEqual({ kind: "not_in_household" });
  });
});
