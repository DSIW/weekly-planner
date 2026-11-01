import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markLeftovers, moveDay, reopenDay, swapDays } from "../src/api";
import { dropFor } from "../src/plan-moves";
import { api, renderApp, server } from "./helpers";

const ME = `GET ${api}/me`;
const CURRENT = `GET ${api}/sessions/current`;
const LEFTOVERS = `POST ${api}/sessions/s1/days/2026-11-02/leftovers`;
const REOPEN = `POST ${api}/sessions/s1/days/2026-11-03/reopen`;
const signedIn = { [ME]: { status: 200, body: { member: { id: "2", name: "Max" } } } };

const pasta = {
  id: 1,
  name: "Pasta",
  minutes: 30,
  base: "pasta",
  diet: "vegetarian",
  needsTime: false,
  planAhead: false,
};
const board = (days: unknown[]) => ({ id: "s1", status: "open", startedBy: "2", days, proposals: [] });
const days = [
  { date: "2026-11-02", status: "open" },
  { date: "2026-11-03", status: "planned", recipe: pasta },
  { date: "2026-11-07", status: "leftovers" },
];

beforeEach(() => {
  vi.stubGlobal(
    "EventSource",
    class {
      addEventListener() {}
      close() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("shaping the plan on the board", () => {
  it("marks an open day as leftovers", async () => {
    const calls = server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: board(days) } },
      [LEFTOVERS]: { status: 200, body: { session: board(days) } },
    });
    renderApp();
    const row = (await screen.findAllByRole("listitem"))[0]!;
    await userEvent.click(row.querySelector("button.small")!);
    expect(calls.some((c) => c.key === LEFTOVERS)).toBe(true);
  });

  it("reopens an agreed day", async () => {
    const calls = server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: board(days) } },
      [REOPEN]: { status: 200, body: { session: board(days) } },
    });
    renderApp();
    await userEvent.click((await screen.findAllByRole("button", { name: "Wieder öffnen" }))[0]!);
    expect(calls.some((c) => c.key === REOPEN)).toBe(true);
  });

  it("offers a drag handle only on agreed days", async () => {
    server({ ...signedIn, [CURRENT]: { status: 200, body: { session: board(days) } } });
    renderApp();
    expect(await screen.findAllByRole("button", { name: /verschieben/ })).toHaveLength(1);
  });

  it("says why when a day cannot be changed because a proposal is waiting", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: board(days) } },
      [LEFTOVERS]: { status: 409, body: { error: "proposal_already_pending" } },
    });
    renderApp();
    await userEvent.click((await screen.findAllByRole("listitem"))[0]!.querySelector("button.small")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Abstimmung");
  });

  it("says so when reopening fails for any other reason", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: board(days) } },
      [REOPEN]: { status: 500, body: {} },
    });
    renderApp();
    await userEvent.click((await screen.findAllByRole("button", { name: "Wieder öffnen" }))[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });
});

describe("what a drop means", () => {
  const d = [
    { date: "a", status: "planned" },
    { date: "b", status: "planned" },
    { date: "c", status: "open" },
    { date: "d", status: "leftovers" },
  ] as never;
  it("swaps with an agreed day", () => expect(dropFor(d, "a", "b")).toEqual({ kind: "swap", a: "a", b: "b" }));
  it("moves onto an open day", () => expect(dropFor(d, "a", "c")).toEqual({ kind: "move", from: "a", to: "c" }));
  it("does nothing onto a leftover day, itself, or from a day that is not agreed", () => {
    expect(dropFor(d, "a", "d")).toBeNull();
    expect(dropFor(d, "a", "a")).toBeNull();
    expect(dropFor(d, "c", "a")).toBeNull();
    expect(dropFor(d, "a", "zzz")).toBeNull();
  });
});

describe("the plan-shaping requests", () => {
  it("send the dates as the server expects them, and name the reason when refused", async () => {
    const calls = server({
      [`POST ${api}/sessions/s1/swap`]: { status: 422, body: { error: "too_long_for_weekday" } },
      [`POST ${api}/sessions/s1/move`]: { status: 200, body: { session: board([]) } },
      [`POST ${api}/sessions/s1/days/2026-11-02/leftovers`]: { status: 200, body: { session: board([]) } },
      [`POST ${api}/sessions/s1/days/2026-11-02/reopen`]: { status: 200, body: { session: board([]) } },
    });
    await expect(swapDays("s1", "2026-11-02", "2026-11-03")).rejects.toMatchObject({ reason: "too_long_for_weekday" });
    await moveDay("s1", "2026-11-02", "2026-11-07");
    await markLeftovers("s1", "2026-11-02");
    await reopenDay("s1", "2026-11-02");
    expect(calls.map((c) => c.body)).toEqual([
      { a: "2026-11-02", b: "2026-11-03" },
      { from: "2026-11-02", to: "2026-11-07" },
      undefined,
      undefined,
    ]);
  });
});
