import { describe, expect, it } from "vitest";
import { beginStep, failStep, planDate, type PlanningSession, type Result } from "@weekly-planner/domain";
import { ExportNotApplied } from "../src/index.js";
import { household } from "./household.js";
import { AC, ME, aRecipe } from "./support/in-memory.js";

const MON = planDate("2026-11-02");
const TUE = planDate("2026-11-03");
const WED = planDate("2026-11-04");

const ok = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`setup failed: ${r.reason}`);
  return r.value;
};

const pasta = aRecipe(1, {
  ingredients: [
    { id: 11, name: "Zwiebel", description: "2 Stück, gehackt", optional: false },
    { name: "Mehl", description: "400 g, Type 550", optional: false },
    { name: "Petersilie", description: "1 Bund", optional: true },
  ],
});
const curry = aRecipe(2, {
  yields: 4,
  ingredients: [
    { id: 11, name: "Zwiebel", description: "2 Stück", optional: false },
    { name: "Mehl", description: "0.2 kg", optional: false },
    { name: "Salz", description: "etwas", optional: false },
  ],
});

async function agree(h: ReturnType<typeof household>, s: PlanningSession, date: typeof MON, recipe = pasta) {
  const proposed = ok(await h.proposeRecipe.execute({ member: AC, sessionId: s.id, date, recipeId: recipe.id }));
  const id = proposed.proposals.at(-1)!.id;
  return ok(await h.acceptProposal.execute({ member: ME, sessionId: s.id, proposalId: id }));
}

/** Two agreed days, ready to finalize. */
async function planned() {
  const h = household([pasta, curry]);
  const s = ok(await h.startSession.execute({ member: AC, dates: [MON, TUE, WED] }));
  await agree(h, s, MON, pasta);
  await agree(h, s, TUE, curry);
  return { h, id: s.id };
}

describe("FinalizePlan", () => {
  it("finalizes, writes one planner entry per day and one scaled, consolidated list in one batch", async () => {
    const { h, id } = await planned();
    const { session, export: exported } = ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    expect(session.status).toBe("finalized");
    expect(h.planner.entries).toEqual([
      { recipeId: pasta.id, date: MON, portions: 2 },
      { recipeId: curry.id, date: TUE, portions: 2 },
    ]);
    expect(h.planner.batches).toEqual([
      [
        { id: 11, name: "Zwiebel", description: "3 Stück", optional: false },
        { name: "Mehl", description: "500 g", optional: false },
        { name: "Salz", description: "etwas", optional: false },
      ],
    ]);
    expect(exported.list.status).toBe("done");
    expect(exported.days.map((d) => d.status)).toEqual(["done", "done"]);
    expect(h.events.published.filter((e) => e.type === "ExportProgressed").at(-1)).toMatchObject({ complete: true });
  });

  it("reads the ingredients from the catalogue when the session's copy of the recipe has none", async () => {
    const bare = { ...pasta };
    delete (bare as { ingredients?: unknown }).ingredients;
    const h = household([bare]);
    const s = ok(await h.startSession.execute({ member: AC, dates: [MON, TUE] }));
    await agree(h, s, MON, bare);
    expect((await h.sessions.get(s.id))?.days[0]?.recipe?.ingredients).toBeUndefined();
    h.catalog.entries = [{ kind: "ready", recipe: pasta }];
    ok(await h.finalizePlan.execute({ member: ME, sessionId: s.id }));
    expect(h.planner.batches[0]?.map((i) => i.name)).toEqual(["Zwiebel", "Mehl"]);
  });

  it("falls back to the session's copy when the catalogue no longer has the recipe", async () => {
    const { h, id } = await planned();
    h.catalog.entries = [];
    ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    expect(h.planner.batches[0]?.map((i) => i.name)).toEqual(["Zwiebel", "Mehl", "Salz"]);
  });

  it("rejects a session that is not open or has nothing planned, and writes nothing", async () => {
    const h = household([pasta]);
    const s = ok(await h.startSession.execute({ member: AC, dates: [MON, TUE] }));
    expect(await h.finalizePlan.execute({ member: ME, sessionId: s.id })).toEqual({
      ok: false,
      reason: "nothing_planned",
    });
    expect(await h.finalizePlan.execute({ member: ME, sessionId: "nope" as typeof s.id })).toEqual({
      ok: false,
      reason: "unknown_session",
    });
    expect(h.exports.bySession.size).toBe(0);
    expect(h.planner.entries).toEqual([]);
  });

  it("does not export a plan twice when finalize is pressed again", async () => {
    const { h, id } = await planned();
    ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    expect(await h.finalizePlan.execute({ member: AC, sessionId: id })).toEqual({
      ok: false,
      reason: "session_not_open",
    });
    expect(h.planner.entries).toHaveLength(2);
    expect(h.planner.batches).toHaveLength(1);
  });

  it("freezes the list at finalizing: a later catalogue change is not sent on retry", async () => {
    const { h, id } = await planned();
    h.planner.failures.push(new ExportNotApplied("down"));
    const first = ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    expect(first.export.failure).toBe("refused");
    h.catalog.entries = [];
    ok(await h.retryExport.execute({ sessionId: id, resendUnconfirmed: false }));
    expect(h.planner.batches[0]?.map((i) => i.name)).toEqual(["Zwiebel", "Mehl", "Salz"]);
  });
});

describe("the export saga", () => {
  it("records a step as sending before the request and done after it", async () => {
    const { h, id } = await planned();
    const seen: string[] = [];
    const original = h.planner.addPlannerEntry.bind(h.planner);
    h.planner.addPlannerEntry = async (entry) => {
      seen.push(
        h.exports.bySession
          .get(id)
          ?.days.map((d) => d.status)
          .join(",") ?? "",
      );
      await original(entry);
    };
    ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    expect(seen).toEqual(["sending,pending", "done,sending"]);
  });

  it("retries after a refused request without duplicating what was already written", async () => {
    const { h, id } = await planned();
    // The first planner entry goes through, the second is refused.
    let calls = 0;
    const original = h.planner.addPlannerEntry.bind(h.planner);
    h.planner.addPlannerEntry = async (entry) => {
      if (++calls === 2) throw new ExportNotApplied("HTTP 503");
      await original(entry);
    };
    const first = ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    expect(first.export.failure).toBe("refused");
    expect(first.export.days.map((d) => d.status)).toEqual(["done", "pending"]);
    expect(h.planner.batches).toEqual([]);
    const retried = ok(await h.retryExport.execute({ sessionId: id, resendUnconfirmed: false }));
    expect(retried.failure).toBeNull();
    expect(h.planner.entries.map((e) => e.date)).toEqual([MON, TUE]);
    expect(h.planner.batches).toHaveLength(1);
    // Retrying a finished export sends nothing.
    ok(await h.retryExport.execute({ sessionId: id, resendUnconfirmed: false }));
    expect(h.planner.entries).toHaveLength(2);
    expect(h.planner.batches).toHaveLength(1);
  });

  it("does not send a step again on its own when the answer never came, only when a member says so", async () => {
    const { h, id } = await planned();
    h.planner.failures.push(new Error("timeout"));
    const first = ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    expect(first.export.failure).toBe("unconfirmed");
    expect(first.export.days[0]?.status).toBe("sending");
    expect(await h.retryExport.execute({ sessionId: id, resendUnconfirmed: false })).toEqual({
      ok: false,
      reason: "step_unconfirmed",
    });
    expect(h.planner.entries).toEqual([]);
    const resent = ok(await h.retryExport.execute({ sessionId: id, resendUnconfirmed: true }));
    expect(resent.failure).toBeNull();
    expect(h.planner.entries.map((e) => e.date)).toEqual([MON, TUE]);
    expect(h.planner.batches).toHaveLength(1);
  });

  it("treats a crash between sending and done like a missing answer", async () => {
    const { h, id } = await planned();
    // The process died after "sending" was saved: the state on disk says sending and nothing else happened.
    ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    const e = h.exports.bySession.get(id)!;
    h.exports.bySession.set(id, { ...e, list: { ...e.list, status: "sending" } });
    const batches = h.planner.batches.length;
    expect(await h.retryExport.execute({ sessionId: id, resendUnconfirmed: false })).toEqual({
      ok: false,
      reason: "step_unconfirmed",
    });
    expect(h.planner.batches).toHaveLength(batches);
  });

  it("refuses a second run while one is in flight", async () => {
    const { h, id } = await planned();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const original = h.planner.addPlannerEntry.bind(h.planner);
    h.planner.addPlannerEntry = async (entry) => {
      await gate;
      await original(entry);
    };
    const first = h.finalizePlan.execute({ member: ME, sessionId: id });
    await new Promise((r) => setTimeout(r, 0));
    expect(await h.retryExport.execute({ sessionId: id, resendUnconfirmed: true })).toEqual({
      ok: false,
      reason: "export_running",
    });
    release();
    ok(await first);
    expect(h.planner.entries).toHaveLength(2);
  });

  it("only retries a finalized session", async () => {
    const { h, id } = await planned();
    expect(await h.retryExport.execute({ sessionId: id, resendUnconfirmed: false })).toEqual({
      ok: false,
      reason: "session_not_finalized",
    });
    expect(await h.retryExport.execute({ sessionId: "nope" as typeof id, resendUnconfirmed: false })).toEqual({
      ok: false,
      reason: "unknown_session",
    });
  });

  it("sends a plan without any ingredient as planner entries only", async () => {
    const h = household([aRecipe(5)]);
    const s = ok(await h.startSession.execute({ member: AC, dates: [MON, TUE] }));
    await agree(h, s, MON, aRecipe(5));
    const { export: exported } = ok(await h.finalizePlan.execute({ member: ME, sessionId: s.id }));
    expect(exported.list.status).toBe("done");
    expect(h.planner.batches).toEqual([]);
    expect(h.planner.entries).toHaveLength(1);
  });
});

describe("GetFinalizePreview", () => {
  it("shows the consolidated list of an open session, with items to check", async () => {
    const { h, id } = await planned();
    const preview = ok(await h.getFinalizePreview.execute({ sessionId: id }));
    expect(preview.dinners).toEqual([
      { date: MON, recipeName: pasta.name },
      { date: TUE, recipeName: curry.name },
    ]);
    expect(preview.items.map((i) => [i.name, i.description, i.needsReview])).toEqual([
      ["Zwiebel", "3 Stück", false],
      ["Mehl", "500 g", false],
      ["Salz", "etwas", true],
    ]);
    expect(h.planner.entries).toEqual([]);
  });

  it("rejects what cannot be finalized", async () => {
    const h = household([pasta]);
    const s = ok(await h.startSession.execute({ member: AC, dates: [MON, TUE] }));
    expect(await h.getFinalizePreview.execute({ sessionId: s.id })).toEqual({ ok: false, reason: "nothing_planned" });
    expect(await h.getFinalizePreview.execute({ sessionId: "x" as typeof s.id })).toEqual({
      ok: false,
      reason: "unknown_session",
    });
    await agree(h, s, MON);
    ok(await h.finalizePlan.execute({ member: ME, sessionId: s.id }));
    expect(await h.getFinalizePreview.execute({ sessionId: s.id })).toEqual({ ok: false, reason: "session_not_open" });
  });
});

describe("the current session", () => {
  it("is the open session, else a finalized one whose export is unfinished, else none", async () => {
    const { h, id } = await planned();
    expect((await h.getCurrentSession.execute())?.id).toBe(id);
    h.planner.failures.push(new ExportNotApplied("down"));
    ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    expect((await h.getCurrentSession.execute())?.status).toBe("finalized");
    // A new session may start while the export is unfinished, and then it is the one shown.
    const next = ok(
      await h.startSession.execute({ member: AC, dates: [planDate("2026-11-09"), planDate("2026-11-10")] }),
    );
    expect((await h.getCurrentSession.execute())?.id).toBe(next.id);
    ok(await h.closeSession.execute({ member: AC, sessionId: next.id }));
    expect((await h.getCurrentSession.execute())?.id).toBe(id);
    ok(await h.retryExport.execute({ sessionId: id, resendUnconfirmed: false }));
    expect(await h.getCurrentSession.execute()).toBeNull();
  });

  it("lets a member give up on an unfinished export by closing the session", async () => {
    const { h, id } = await planned();
    h.planner.failures.push(new ExportNotApplied("down"));
    ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    ok(await h.closeSession.execute({ member: AC, sessionId: id }));
    expect(await h.getCurrentSession.execute()).toBeNull();
    expect(await h.retryExport.execute({ sessionId: id, resendUnconfirmed: false })).toEqual({
      ok: false,
      reason: "session_not_finalized",
    });
  });
});

describe("RetryRefusedExports", () => {
  it("sends again what was refused, without repeating what was written", async () => {
    const { h, id } = await planned();
    h.planner.failures.push(new ExportNotApplied("down"));
    ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    expect(await h.retryRefusedExports.execute()).toBe(1);
    expect(h.planner.entries.map((e) => e.date)).toEqual([MON, TUE]);
    expect(h.planner.batches).toHaveLength(1);
    expect(h.exports.bySession.get(id)?.failure).toBeNull();
    expect(await h.retryRefusedExports.execute()).toBe(0); // complete: nothing left to try
  });

  it("tries again on every run while KitchenOwl keeps refusing", async () => {
    const { h, id } = await planned();
    h.planner.failures.push(new ExportNotApplied("down"), new ExportNotApplied("down"), new ExportNotApplied("down"));
    ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    expect(await h.retryRefusedExports.execute()).toBe(1);
    expect(h.exports.bySession.get(id)?.failure).toBe("refused");
    expect(await h.retryRefusedExports.execute()).toBe(1);
    expect(h.planner.entries).toEqual([]);
    expect(await h.retryRefusedExports.execute()).toBe(1);
    expect(h.planner.entries).toHaveLength(2);
  });

  it("never sends a step again that went out without an answer", async () => {
    const { h, id } = await planned();
    h.planner.failures.push(new Error("socket hang up"));
    ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    expect(h.exports.bySession.get(id)?.failure).toBe("unconfirmed");
    expect(await h.retryRefusedExports.execute()).toBe(0);
    expect(h.planner.entries).toEqual([]);
  });

  it("does not send a step a member's retry left unconfirmed between its look and its send", async () => {
    const { h, id } = await planned();
    h.planner.failures.push(new ExportNotApplied("down"));
    ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    const stale = h.exports.bySession.get(id)!; // still refused and waiting when the job looks
    const sent = ok(beginStep(stale, { kind: "planner", date: MON }, { resendUnconfirmed: false })).state;
    h.exports.bySession.set(id, ok(failStep(sent, { kind: "planner", date: MON }, "unconfirmed")).state);
    const get = h.exports.get.bind(h.exports);
    let looked = false;
    h.exports.get = async (sessionId) => (looked ? get(sessionId) : ((looked = true), stale));
    await h.retryRefusedExports.execute();
    expect(h.planner.entries).toEqual([]);
    expect(h.exports.bySession.get(id)?.failure).toBe("unconfirmed");
  });

  it("leaves a plan alone that is not finalized, even if an export record says refused", async () => {
    const { h, id } = await planned();
    h.planner.failures.push(new ExportNotApplied("down"));
    ok(await h.finalizePlan.execute({ member: ME, sessionId: id }));
    ok(await h.closeSession.execute({ member: ME, sessionId: id }));
    expect(h.sessions.byId.get(id)?.status).toBe("closed");
    expect(await h.retryRefusedExports.execute()).toBe(0);
    expect(h.planner.entries).toEqual([]);
  });
});
