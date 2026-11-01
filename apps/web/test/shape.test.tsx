import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markLeftovers, moveDay, reopenDay, swapDays } from "../src/api";
import { dropFor } from "../src/plan-moves";
import { api, dayRows, findDayRows, renderApp, server } from "./helpers";

const ME = `GET ${api}/me`;
const CURRENT = `GET ${api}/sessions/current`;
const LEFTOVERS = `POST ${api}/sessions/s1/days/2026-11-02/leftovers`;
const REOPEN = `POST ${api}/sessions/s1/days/2026-11-03/reopen`;
const PREVIEW = `GET ${api}/sessions/s1/finalize-preview`;
const preview = { status: 200, body: { dinners: [], items: [] } };
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
    const row = (await findDayRows())[0]!;
    await userEvent.click(row.querySelector("button.small")!);
    expect(calls.some((c) => c.key === LEFTOVERS)).toBe(true);
  });

  it("shows the new state and frees the buttons as soon as the request is answered, not after the reload", async () => {
    const afterLeftovers = days.map((d) => (d.date === "2026-11-02" ? { ...d, status: "leftovers" } : d));
    const calls = server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: board(days) } },
      [LEFTOVERS]: { status: 200, body: { session: board(afterLeftovers) } },
    });
    const answer = globalThis.fetch;
    let slow = false;
    // Whatever is read again after the click takes a long while, as the card deck does.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (slow && !init?.method) await new Promise((resolve) => setTimeout(resolve, 3000));
        return answer(url, init);
      }),
    );
    renderApp();
    const row = (await findDayRows())[0]!;
    slow = true;
    await userEvent.click(row.querySelector("button.small")!);
    await waitFor(() => expect(dayRows()[0]).toHaveTextContent("Reste"));
    expect(within(dayRows()[0]!).getByRole("button", { name: "Doch kochen" })).toBeEnabled();
    expect(calls.filter((c) => c.key === CURRENT)).toHaveLength(1); // the reload is still on its way
  });

  it("reopens an agreed day", async () => {
    const calls = server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: board(days) } },
      [REOPEN]: { status: 200, body: { session: board(days) } },
    });
    renderApp();
    await userEvent.click((await screen.findAllByRole("button", { name: "Neu wählen" }))[0]!);
    expect(calls.some((c) => c.key === REOPEN)).toBe(true);
  });

  it("names the way back by what the day is: cook after all for leftovers, choose again for an agreed dish", async () => {
    const calls = server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: board(days) } },
      [`POST ${api}/sessions/s1/days/2026-11-07/reopen`]: { status: 200, body: { session: board(days) } },
    });
    renderApp();
    const rows = await findDayRows();
    expect(rows[0]).not.toHaveTextContent(/Doch kochen|Neu wählen/); // an open day offers "Reste"
    expect(rows[1]).toHaveTextContent("Neu wählen");
    expect(rows[2]).toHaveTextContent("Doch kochen");
    expect(screen.queryByRole("button", { name: "Wieder öffnen" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Doch kochen" }));
    expect(calls.some((c) => c.key.endsWith("/days/2026-11-07/reopen"))).toBe(true);
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
      [PREVIEW]: preview,
      [LEFTOVERS]: { status: 409, body: { error: "proposal_already_pending" } },
    });
    renderApp();
    await userEvent.click((await findDayRows())[0]!.querySelector("button.small")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("wartet schon ein Vorschlag");
  });

  it("says so when reopening fails for any other reason", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: board(days) } },
      [PREVIEW]: preview,
      [REOPEN]: { status: 500, body: {} },
    });
    renderApp();
    await userEvent.click((await screen.findAllByRole("button", { name: "Neu wählen" }))[0]!);
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
