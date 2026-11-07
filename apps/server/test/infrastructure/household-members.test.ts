import { memberId } from "@weekly-planner/domain";
import { describe, expect, it } from "vitest";
import { KitchenOwlClient } from "../../src/infrastructure/kitchenowl/client.js";
import { KitchenOwlHouseholdMembers } from "../../src/infrastructure/kitchenowl/kitchenowl-household-members.js";

const cfg = { kitchenowlUrl: "https://ko.test", kitchenowlToken: "service", householdId: 2 };

// Shapes taken from the staging KitchenOwl (GET /household/{id}: member[] with name and photo; GET /upload/{file}).
function fakeKitchenOwl() {
  const paths: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const path = String(url).replace("https://ko.test/api", "");
    paths.push(path);
    if (path === "/household/2")
      return new Response(
        JSON.stringify({
          member: [
            { id: 2, name: "Max", photo: "11d7.png", admin: true },
            { id: 3, name: "AC", photo: null },
            { id: 4, name: "Neu" },
          ],
        }),
      );
    if (path === "/upload/11d7.png")
      return new Response(new Uint8Array([137, 80]), { headers: { "content-type": "image/png" } });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { paths, client: new KitchenOwlClient(cfg, fetchImpl) };
}

describe("KitchenOwlHouseholdMembers", () => {
  it("lists names with the picture's file name, null for members without one", async () => {
    const { client } = fakeKitchenOwl();
    const members = new KitchenOwlHouseholdMembers(client);
    expect(await members.list()).toEqual([
      { id: "2", name: "Max", avatar: "11d7.png" },
      { id: "3", name: "AC", avatar: null },
      { id: "4", name: "Neu", avatar: null },
    ]);
  });

  it("fetches a member's own picture, and nothing for one without or for a stranger", async () => {
    const { client, paths } = fakeKitchenOwl();
    const members = new KitchenOwlHouseholdMembers(client);
    expect(await members.avatar(memberId("2"))).toEqual({ contentType: "image/png", data: new Uint8Array([137, 80]) });
    expect(await members.avatar(memberId("3"))).toBeNull();
    expect(await members.avatar(memberId("99"))).toBeNull();
    expect(paths.filter((p) => p.startsWith("/upload"))).toEqual(["/upload/11d7.png"]);
  });

  it("asks KitchenOwl once for a while, and again after that", async () => {
    const { client, paths } = fakeKitchenOwl();
    let now = 0;
    const members = new KitchenOwlHouseholdMembers(client, () => now);
    await members.list();
    await members.list();
    expect(paths.filter((p) => p === "/household/2")).toHaveLength(1);
    now = 11 * 60_000;
    await members.list();
    expect(paths.filter((p) => p === "/household/2")).toHaveLength(2);
  });

  it("serves no file that is not an image", async () => {
    const client = new KitchenOwlClient(cfg, (async (url: string | URL | Request) =>
      String(url).endsWith("/household/2")
        ? new Response(JSON.stringify({ member: [{ id: 2, name: "Max", photo: "x.html" }] }))
        : new Response("<script>", { headers: { "content-type": "text/html" } })) as typeof fetch);
    expect(await new KitchenOwlHouseholdMembers(client).avatar(memberId("2"))).toBeNull();
  });
});
