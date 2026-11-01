// End-to-end check of the built app: the real web client code (apps/web/src/api.ts, bundled for Node) talks to the
// real server bundle (apps/server/dist/server.js) with a real SQLite file, against a fake KitchenOwl. It exists
// because mocks on either side hide mistakes in the contract between them, such as a request the server rejects.
// Run after `npm run build`: `npm run smoke`. Every slice adds its steps here.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "planner-smoke-"));
const members = {
  dsiw: { id: 2, name: "Max" },
  ac: { id: 3, name: "AC" },
  outsider: { id: 9, name: "Stranger" },
};
const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

// Every recipe carries the "proven" tag, as the real ones carry either that or "new".
const tags = (...names) => [...names, "✅ Erprobt"].map((name) => ({ name }));
const item = (id, name, description) => ({ id, name, description, optional: false });
const recipes = [
  {
    id: 1,
    name: "Pasta",
    time: 30,
    photo: "pasta.jpg",
    yields: 2,
    items: [item(101, "Zwiebel", "1 Stück, gehackt"), item(102, "Mehl", "200 g")],
    tags: tags("🍽️ Hauptgericht", "🥬 Vegetarisch", "🍝 Pasta"),
  },
  {
    id: 2,
    name: "Curry",
    time: 25,
    yields: 4,
    items: [item(101, "Zwiebel", "2 Stück"), item(102, "Mehl", "0.1 kg"), item(103, "Salz", "etwas")],
    tags: tags("🍽️ Hauptgericht", "🌱 Vegan", "🍚 Reis"),
  },
  { id: 3, name: "Risotto", time: 40, tags: tags("🍽️ Hauptgericht", "🥬 Vegetarisch", "🍚 Reis") },
  { id: 4, name: "Schmorbraten", time: 120, tags: tags("🍽️ Hauptgericht", "🥩 Fleisch") },
  { id: 5, name: "Tiramisu", time: 30, tags: tags("🍦 Dessert", "🥬 Vegetarisch") },
  { id: 6, name: "Linsensuppe", time: 35, tags: tags("🍽️ Hauptgericht", "🌱 Vegan") },
];

// What reached the fake KitchenOwl's write endpoints, and how it should behave on the next request.
const written = { planner: [], list: [] };
const behaviour = { plannerStatus: 200, listHangs: false };

/** Just enough of KitchenOwl: sign-in with the password "pw", who is who, the household and its recipes. */
const kitchenowl = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => {
    body += c;
  });
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    const send = (status, value) => {
      res.statusCode = status;
      res.end(JSON.stringify(value));
    };
    if (req.url === "/api/auth") {
      const { username, password } = JSON.parse(body || "{}");
      return members[username] && password === "pw" ? send(200, { access_token: `t-${username}` }) : send(401, {});
    }
    if (req.url === "/api/user") {
      const name = String(req.headers.authorization ?? "").replace("Bearer t-", "");
      return members[name] ? send(200, { ...members[name], username: name }) : send(401, {});
    }
    if (req.url === "/api/household/2") return send(200, { member: [{ id: 2 }, { id: 3 }] });
    if (req.url === "/api/household/2/recipe") return send(200, recipes);
    if (req.method === "POST" && req.url === "/api/household/2/planner/recipe") {
      if (behaviour.plannerStatus !== 200) return send(behaviour.plannerStatus, {});
      written.planner.push(JSON.parse(body));
      return send(200, {});
    }
    if (req.method === "POST" && req.url === "/api/shoppinglist/2/recipeitems") {
      written.list.push(JSON.parse(body));
      // A hanging answer stands for the process dying between sending a request and hearing back.
      return behaviour.listHangs ? undefined : send(200, {});
    }
    if (req.url === "/api/upload/pasta.jpg") {
      if (req.headers.authorization !== "Bearer service-token") return send(401, {});
      res.setHeader("content-type", "image/jpeg");
      res.statusCode = 200;
      return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    }
    return send(404, {});
  });
});

let serverPort = 0;
let proc = null;
let serverLog = "";
const origin = () => `http://127.0.0.1:${serverPort}`;

async function startServer(kitchenowlPort) {
  proc = spawn(process.execPath, [join(root, "apps/server/dist/server.js")], {
    env: {
      ...process.env,
      PORT: String(serverPort),
      BASE_PATH: "/plan",
      WEB_DIST: join(root, "apps/web/dist"),
      DATABASE_PATH: join(work, "planner.sqlite"),
      KITCHENOWL_URL: `http://127.0.0.1:${kitchenowlPort}`,
      KITCHENOWL_TOKEN: "service-token",
      KITCHENOWL_HOUSEHOLD_ID: "2",
      SESSION_SECRET: "smoke-test-secret-smoke-test-secret",
      COOKIE_SECURE: "false",
      NODE_NO_WARNINGS: "1",
    },
  });
  for (const stream of [proc.stdout, proc.stderr]) {
    stream.on("data", (c) => {
      serverLog += c;
    });
  }
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${origin()}/plan/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start:\n${serverLog}`);
}

/** Kills the server without letting it finish anything, the way a crash would. */
async function crashServer() {
  const exited = new Promise((resolve) => proc.once("exit", resolve));
  proc.kill("SIGKILL");
  await exited;
}

async function stopServer() {
  const exited = new Promise((resolve) => proc.once("exit", resolve));
  proc.kill("SIGTERM");
  await exited;
}

// The web client's own code, bundled for Node. It calls fetch with relative URLs, so fetch is wrapped to add the
// origin and keep one cookie jar per member, the way two browsers would.
const bundle = join(work, "web-api.mjs");
await build({
  entryPoints: [join(root, "apps/web/src/api.ts")],
  outfile: bundle,
  bundle: true,
  format: "esm",
  platform: "node",
  define: { "import.meta.env.BASE_URL": '"/plan/"' },
  logLevel: "error",
});
const web = await import(pathToFileURL(bundle).href);

const realFetch = globalThis.fetch;
const jars = new Map();
let who = "nobody";
globalThis.fetch = async (input, init = {}) => {
  const headers = new Headers(init.headers);
  const jar = jars.get(who);
  if (jar?.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
  const res = await realFetch(new URL(input, origin()), { ...init, headers });
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const [name, ...value] = pair.split("=");
    const cleared = value.join("=") === "" || /max-age=0/i.test(line);
    const own = jars.get(who) ?? new Map();
    if (cleared) own.delete(name);
    else own.set(name, value.join("="));
    jars.set(who, own);
  }
  return res;
};
const as = (name, fn) => {
  who = name;
  return fn();
};

let failed = false;
async function step(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed = true;
    console.log(`  FAIL ${name}\n${error instanceof Error ? error.stack : error}`);
    throw error;
  }
}

// Fixed weekdays (Monday to Thursday): the weekday limit on cooking times depends on the date.
const D1 = "2026-11-02";
const D2 = "2026-11-03";
const D3 = "2026-11-04";
const D4 = "2026-11-05";

try {
  const kitchenowlPort = await listen(kitchenowl);
  const free = http.createServer();
  serverPort = await listen(free);
  await new Promise((r) => free.close(r));
  await startServer(kitchenowlPort);
  console.log(`smoke: server on ${origin()}, fake KitchenOwl on ${kitchenowlPort}`);

  await step("serves the web app, manifest and service worker under /plan", async () => {
    for (const path of ["/plan/", "/plan/manifest.webmanifest", "/plan/sw.js"]) {
      assert.equal((await realFetch(`${origin()}${path}`)).status, 200, path);
    }
  });

  await step("sign-in: wrong password and outsiders are refused with the right reason", async () => {
    const wrong = await as("dsiw", () => web.login("dsiw", "nope").catch((e) => e));
    assert.equal(wrong.reason, "invalid_credentials");
    const outsider = await as("outsider", () => web.login("outsider", "pw").catch((e) => e));
    assert.equal(outsider.reason, "not_in_household");
  });

  await step("sign-in: both members sign in and are recognised", async () => {
    assert.equal((await as("dsiw", () => web.login("dsiw", "pw"))).name, "Max");
    assert.equal((await as("ac", () => web.login("ac", "pw"))).name, "AC");
    assert.equal((await as("dsiw", () => web.fetchMe())).name, "Max");
    assert.equal(await as("nobody", () => web.fetchMe()), null);
  });

  await step("no session yet for either member", async () => {
    assert.equal(await as("dsiw", () => web.fetchCurrentSession()), null);
    assert.equal(await as("ac", () => web.fetchCurrentSession()), null);
  });

  let sessionId = "";
  await step("one member starts a session, the other sees it and is told live", async () => {
    const controller = new AbortController();
    const stream = await realFetch(`${origin()}/plan/api/events`, {
      headers: { cookie: [...jars.get("ac")].map(([k, v]) => `${k}=${v}`).join("; ") },
      signal: controller.signal,
    });
    assert.equal(stream.headers.get("content-type"), "text/event-stream");
    const reader = stream.body.getReader();
    let received = "";
    const until = async (needle) => {
      while (!received.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        received += new TextDecoder().decode(value);
      }
    };
    await until("event: ready");
    const started = await as("dsiw", () => web.startSession([D2, D1]));
    sessionId = started.id;
    assert.deepEqual(
      started.days.map((d) => d.date),
      [D1, D2],
    );
    await until("event: changed");
    controller.abort();
    assert.deepEqual(await as("ac", () => web.fetchCurrentSession()), started);
  });

  await step("a second start is refused while one is open", async () => {
    const refused = await as("ac", () => web.startSession([D3, D4]).catch((e) => e));
    assert.equal(refused.reason, "session_already_open");
  });

  const names = (list) => list.recipes.map((r) => r.name);
  let firstProposal = "";
  await step("the list offers dinners for the next open day: no dessert, no long recipe on a weekday", async () => {
    const list = await as("ac", () => web.fetchEligibleRecipes(sessionId));
    assert.equal(list.date, D1);
    assert.deepEqual(names(list), ["Curry", "Linsensuppe", "Pasta", "Risotto"]);
  });

  await step("the deck is ranked, and the same for both members on every request", async () => {
    const first = await as("dsiw", () => web.fetchDeck(sessionId));
    assert.equal(first.date, D1);
    assert.deepEqual([...names({ recipes: first.cards })].sort(), ["Curry", "Linsensuppe", "Pasta", "Risotto"]);
    for (const who of ["ac", "dsiw", "ac"]) {
      const again = await as(who, () => web.fetchDeck(sessionId));
      assert.deepEqual(again, first, "the order does not change between requests");
    }
    assert.ok(first.cards.every((c) => c.isNew === false && c.planAhead === false));
  });

  await step("a pass hides the dish for the other member too, and only for this session", async () => {
    await as("dsiw", () => web.passRecipe(sessionId, 6));
    const deck = await as("ac", () => web.fetchDeck(sessionId));
    assert.ok(!names({ recipes: deck.cards }).includes("Linsensuppe"));
    const again = await as("ac", () => web.passRecipe(sessionId, 6).catch((e) => e));
    assert.ok(again instanceof web.SessionFailed, "passing the same dish twice is refused");
  });

  await step("recipe photos are served from KitchenOwl, only to signed-in members", async () => {
    const cookie = [...jars.get("ac")].map(([k, v]) => `${k}=${v}`).join("; ");
    const photo = await realFetch(`${origin()}/plan/api/recipes/1/photo`, { headers: { cookie } });
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get("content-type"), "image/jpeg");
    assert.deepEqual([...new Uint8Array(await photo.arrayBuffer())], [0xff, 0xd8, 0xff, 0xe0]);
    assert.equal((await realFetch(`${origin()}/plan/api/recipes/2/photo`, { headers: { cookie } })).status, 404);
    assert.equal((await realFetch(`${origin()}/plan/api/recipes/1/photo`)).status, 401);
  });

  await step("one member proposes, the other sees it, and the proposer cannot accept their own", async () => {
    const proposed = await as("dsiw", () => web.proposeRecipe(sessionId, D1, 1));
    firstProposal = proposed.proposals.find((p) => p.status === "pending").id;
    const seen = await as("ac", () => web.fetchCurrentSession());
    assert.equal(seen.proposals.find((p) => p.status === "pending").recipe.name, "Pasta");
    const own = await as("dsiw", () => web.acceptProposal(sessionId, firstProposal).catch((e) => e));
    assert.ok(own instanceof web.SessionFailed, "accepting your own proposal is refused");
  });

  await step("the other member accepts: the day is planned and the next day comes up without that dish", async () => {
    const accepted = await as("ac", () => web.acceptProposal(sessionId, firstProposal));
    assert.deepEqual(
      accepted.days.map((d) => [d.date, d.status, d.recipe?.name]),
      [
        [D1, "planned", "Pasta"],
        [D2, "open", undefined],
      ],
    );
    const list = await as("dsiw", () => web.fetchEligibleRecipes(sessionId));
    assert.equal(list.date, D2);
    assert.equal((await as("ac", () => web.fetchDeck(sessionId))).date, D2, "the deck moves on to the next day too");
    assert.deepEqual(names(list), ["Curry", "Risotto"]);
  });

  let secondProposal = "";
  await step("two simultaneous proposals leave exactly one pending", async () => {
    const results = await Promise.allSettled([
      as("dsiw", () => web.proposeRecipe(sessionId, D2, 2)),
      as("ac", () => web.proposeRecipe(sessionId, D2, 3)),
    ]);
    const lost = results.filter((r) => r.status === "rejected");
    assert.equal(lost.length, 1);
    assert.equal(lost[0].reason.reason, "proposal_already_pending");
    const current = await as("ac", () => web.fetchCurrentSession());
    const pending = current.proposals.filter((p) => p.status === "pending");
    assert.equal(pending.length, 1);
    secondProposal = pending[0].id;
  });

  await step("a veto keeps the dish out of this session and the day open", async () => {
    const pending = (await as("ac", () => web.fetchCurrentSession())).proposals.find((p) => p.id === secondProposal);
    const decider = pending.proposedBy === "2" ? "ac" : "dsiw";
    const vetoed = await as(decider, () => web.vetoProposal(sessionId, secondProposal));
    assert.equal(vetoed.proposals.find((p) => p.id === secondProposal).status, "vetoed");
    assert.equal(vetoed.days[1].status, "open");
    const list = await as("dsiw", () => web.fetchEligibleRecipes(sessionId));
    assert.ok(!names(list).includes(pending.recipe.name), "the vetoed dish is gone from the list");
  });

  await step("leftovers, reopening and moving shape the plan, and the other member sees each change", async () => {
    const states = (session) => session.days.map((d) => [d.date, d.status, d.recipe?.name]);
    assert.deepEqual(states(await as("dsiw", () => web.markLeftovers(sessionId, D2))), [
      [D1, "planned", "Pasta"],
      [D2, "leftovers", undefined],
    ]);
    assert.equal((await as("ac", () => web.fetchCurrentSession())).days[1].status, "leftovers");
    assert.equal((await as("ac", () => web.reopenDay(sessionId, D2))).days[1].status, "open");
    assert.deepEqual(states(await as("ac", () => web.moveDay(sessionId, D1, D2))), [
      [D1, "open", undefined],
      [D2, "planned", "Pasta"],
    ]);
    assert.deepEqual(states(await as("dsiw", () => web.moveDay(sessionId, D2, D1))), [
      [D1, "planned", "Pasta"],
      [D2, "open", undefined],
    ]);
    const swap = await as("dsiw", () => web.swapDays(sessionId, D1, D2).catch((e) => e));
    assert.equal(swap.reason, "day_not_planned", "only agreed days can be swapped");
    const again = await as("dsiw", () => web.reopenDay(sessionId, D2).catch((e) => e));
    assert.equal(again.reason, "day_already_open");
  });

  await step("recipes can be refreshed from KitchenOwl", async () => {
    await as("dsiw", () => web.refreshRecipes());
  });

  await step("the session, its decisions and the sign-in survive a server restart", async () => {
    await stopServer();
    await startServer(kitchenowlPort);
    const restored = await as("ac", () => web.fetchCurrentSession());
    assert.equal(restored?.id, sessionId);
    assert.equal(restored.days[0].recipe.name, "Pasta");
    assert.equal(restored.proposals.length, 2);
    assert.equal((await as("ac", () => web.fetchMe())).name, "AC");
  });

  let nextSession = "";
  await step("the other member discards it, then a new one can start", async () => {
    const closed = await as("ac", () => web.closeSession(sessionId));
    assert.equal(closed.status, "closed");
    assert.equal(await as("dsiw", () => web.fetchCurrentSession()), null);
    nextSession = (await as("dsiw", () => web.startSession([D3, D4]))).id;
    assert.ok(nextSession);
  });

  // S4a: finalize into KitchenOwl.
  const agreeDay = async (date, recipeId) => {
    const proposed = await as("dsiw", () => web.proposeRecipe(nextSession, date, recipeId));
    const pending = proposed.proposals.find((p) => p.status === "pending").id;
    return as("ac", () => web.acceptProposal(nextSession, pending));
  };
  await step("finalize needs an agreed day, and writes nothing before the button is pressed", async () => {
    const none = await as("dsiw", () => web.finalizePlan(nextSession).catch((e) => e));
    assert.equal(none.reason, "nothing_planned");
    const noPreview = await as("dsiw", () => web.fetchFinalizePreview(nextSession).catch((e) => e));
    assert.match(String(noPreview), /HTTP 409/);
    await agreeDay(D3, 2);
    await agreeDay(D4, 1);
    assert.deepEqual(written, { planner: [], list: [] });
  });

  await step(
    "the preview is scaled to two portions, summed per ingredient, and flags what it cannot read",
    async () => {
      const preview = await as("ac", () => web.fetchFinalizePreview(nextSession));
      assert.deepEqual(
        preview.dinners.map((d) => [d.date, d.recipeName]),
        [
          [D3, "Curry"],
          [D4, "Pasta"],
        ],
      );
      assert.deepEqual(
        preview.items.map((i) => [i.name, i.description, i.needsReview]),
        [
          ["Zwiebel", "2 Stück", false],
          ["Mehl", "250 g", false],
          ["Salz", "etwas", true],
        ],
      );
    },
  );

  let finalizedAt = null;
  await step(
    "a refused planner entry leaves the plan finalized and the retry finishes without duplicates",
    async () => {
      behaviour.plannerStatus = 503;
      const done = await as("dsiw", () => web.finalizePlan(nextSession));
      finalizedAt = done;
      assert.equal(done.status, "finalized");
      assert.equal(done.export.complete, false);
      assert.equal(done.export.failure, "refused");
      assert.deepEqual(written, { planner: [], list: [] });
      // The other member still sees the unfinished export, and cannot start a plan over it.
      const seen = await as("ac", () => web.fetchCurrentSession());
      assert.equal(seen.id, nextSession);
      assert.equal(seen.export.failure, "refused");
      behaviour.plannerStatus = 200;
      const retried = await as("ac", () => web.retryExport(nextSession, false));
      assert.equal(retried.complete, true);
      assert.deepEqual(
        written.planner.map((p) => [p.recipe_id, p.yields]),
        [
          [2, 2],
          [1, 2],
        ],
      );
      assert.equal(written.list.length, 1);
      assert.deepEqual(written.list[0].items, [
        { id: 101, name: "Zwiebel", description: "2 Stück", optional: false },
        { id: 102, name: "Mehl", description: "250 g", optional: false },
        { id: 103, name: "Salz", description: "etwas", optional: false },
      ]);
      assert.equal(await as("dsiw", () => web.fetchCurrentSession()), null, "an exported plan leaves the board");
      const again = await as("dsiw", () => web.retryExport(nextSession, false));
      assert.equal(again.complete, true);
      assert.equal(written.planner.length, 2, "retrying a finished export sends nothing");
      assert.equal(written.list.length, 1);
    },
  );

  await step("finalizing twice is refused", async () => {
    const twice = await as("ac", () => web.finalizePlan(nextSession).catch((e) => e));
    assert.equal(twice.reason, "session_not_open");
    assert.ok(finalizedAt);
  });

  let crashed = "";
  await step("a crash while the list is on its way never sends it twice by itself", async () => {
    await as("dsiw", () => web.startSession([D1, D2]).then((s) => (crashed = s.id)));
    for (const [date, recipeId] of [
      [D1, 3],
      [D2, 1],
    ]) {
      const proposed = await as("dsiw", () => web.proposeRecipe(crashed, date, recipeId));
      const pending = proposed.proposals.find((p) => p.status === "pending").id;
      await as("ac", () => web.acceptProposal(crashed, pending));
    }
    written.planner.length = 0;
    written.list.length = 0;
    behaviour.listHangs = true;
    const inFlight = as("dsiw", () => web.finalizePlan(crashed)).catch(() => undefined);
    for (let i = 0; i < 100 && written.list.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(written.list.length, 1, "the list request reached KitchenOwl");
    await crashServer();
    await inFlight;
    behaviour.listHangs = false;
    await startServer(kitchenowlPort);
    const seen = await as("ac", () => web.fetchCurrentSession());
    assert.equal(seen.id, crashed);
    assert.equal(seen.export.list.status, "sending");
    assert.deepEqual(
      seen.export.days.map((d) => d.status),
      ["done", "done"],
    );
    const refused = await as("ac", () => web.retryExport(crashed, false).catch((e) => e));
    assert.equal(refused.reason, "step_unconfirmed");
    assert.equal(written.list.length, 1, "nothing was sent again");
    assert.equal(written.planner.length, 2);
    const resent = await as("ac", () => web.retryExport(crashed, true));
    assert.equal(resent.complete, true);
    assert.equal(written.list.length, 2, "only the explicit choice sends it again");
    assert.equal(await as("dsiw", () => web.fetchCurrentSession()), null);
  });

  await step("signing out ends the session", async () => {
    await as("dsiw", () => web.logout());
    assert.equal(await as("dsiw", () => web.fetchMe()), null);
  });

  await step("failed calls are logged, without credentials", async () => {
    assert.match(serverLog, /POST \/plan\/api\/login -> 401 invalid_credentials/);
    assert.match(serverLog, /POST \/plan\/api\/login -> 403 not_in_household/);
    assert.match(serverLog, /POST \/plan\/api\/sessions -> 409 session_already_open/);
    assert.match(serverLog, /-> 403 own_proposal/);
    assert.match(serverLog, /POST \/plan\/api\/sessions\/[^ ]+\/passes -> 409 already_passed/);
    assert.match(serverLog, /-> 409 proposal_already_pending/);
    assert.match(serverLog, /-> 409 day_not_planned/);
    assert.match(serverLog, /-> 409 day_already_open/);
    assert.match(serverLog, /POST \/plan\/api\/sessions\/[^ ]+\/finalize -> 409 nothing_planned/);
    assert.match(serverLog, /POST \/plan\/api\/sessions\/[^ ]+\/export\/retry -> 409 step_unconfirmed/);
    assert.match(serverLog, /POST \/plan\/api\/sessions\/[^ ]+\/finalize -> 409 session_not_open/);
    assert.doesNotMatch(serverLog, /nope|"pw"|service-token/);
  });

  console.log("smoke: all steps passed");
} catch {
  console.log(`\nserver log:\n${serverLog}`);
} finally {
  if (proc && proc.exitCode === null) await stopServer();
  kitchenowl.close();
  rmSync(work, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
