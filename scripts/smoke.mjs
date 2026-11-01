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
// What the import sent to KitchenOwl (recipes) and to the language model.
const imported = { recipes: [], llm: [] };
// What the fake planner holds right now (a recipe taken off it in KitchenOwl is removed from here).
const plannerHolds = [];
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
    if (req.method === "GET" && req.url === "/api/household/2/recipe") return send(200, recipes);
    if (req.method === "POST" && req.url === "/api/household/2/planner/recipe") {
      if (behaviour.plannerStatus !== 200) return send(behaviour.plannerStatus, {});
      const entry = JSON.parse(body);
      written.planner.push(entry);
      // KitchenOwl stores the day as midnight UTC.
      plannerHolds.push({ cooking_date: Math.floor(entry.cooking_date / 86_400_000) * 86_400_000 });
      return send(200, {});
    }
    if (req.method === "GET" && req.url === "/api/household/2/planner") return send(200, plannerHolds);
    if (req.method === "GET" && req.url === "/api/household/2/item")
      return send(200, [{ name: "Zwiebel" }, { name: "Linsen" }]);
    if (req.method === "GET" && req.url === "/api/household/2/tag")
      return send(200, [{ name: "🍲 Suppe" }, { name: "🌱 Vegan" }]);
    if (req.method === "POST" && req.url === "/api/household/2/recipe") {
      imported.recipes.push(JSON.parse(body));
      return send(200, { id: 900 + imported.recipes.length, name: "x" });
    }
    // A language model behind an OpenAI-compatible API, answering with a fixed recipe.
    if (req.method === "POST" && req.url === "/llm/chat/completions") {
      imported.llm.push({ auth: req.headers.authorization, body: JSON.parse(body) });
      const recipe = {
        name: "Linsensuppe",
        subtitle: "Wärmt von innen",
        steps: ["Linsen waschen.", "Kochen."],
        ingredients: [
          { name: "linsen", amount: "200 g", optional: false },
          { name: "Petersilie <b>frisch</b> http://evil.example", amount: "1 Bund", optional: false },
        ],
        mealType: "main",
        base: "other",
        diet: "vegan",
        tags: ["🍲 Suppe", "🍕 Pizza"],
        totalMinutes: 40,
        yields: 4,
        visibility: 1,
      };
      return send(200, { choices: [{ message: { content: JSON.stringify(recipe) } }] });
    }
    if (req.url === "/assets/fonts/Items.ttf") {
      res.setHeader("content-type", "font/ttf");
      res.statusCode = 200;
      return res.end(Buffer.from([0, 1, 0, 0]));
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
      LLM_API_KEY: "llm-key",
      LLM_MODEL: "smoke/model",
      LLM_BASE_URL: `http://127.0.0.1:${kitchenowlPort}/llm`,
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

  await step("the proposer takes a proposal back, nobody else can, and the day stays open", async () => {
    const list = await as("dsiw", () => web.fetchEligibleRecipes(sessionId));
    const proposed = await as("dsiw", () => web.proposeRecipe(sessionId, list.date, list.recipes[0].id));
    const mine = proposed.proposals.find((p) => p.status === "pending");
    const other = await as("ac", () => web.withdrawProposal(sessionId, mine.id).catch((e) => e));
    assert.equal(other.reason, "not_your_proposal");
    const back = await as("dsiw", () => web.withdrawProposal(sessionId, mine.id));
    assert.equal(back.proposals.find((p) => p.id === mine.id).status, "withdrawn");
    assert.equal(back.proposals.filter((p) => p.status === "pending").length, 0);
    assert.equal(back.days.find((d) => d.date === list.date).status, "open");
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
    assert.deepEqual(
      restored.proposals.map((p) => p.status),
      ["accepted", "vetoed", "withdrawn"],
    );
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
      // Flour is in stock: it stays off the list.
      const done = await as("dsiw", () => web.finalizePlan(nextSession, ["mehl"]));
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

  await step(
    "proposals for two days wait at once, the dates of a finished plan are refused, then the meal log",
    async () => {
      // Two recent days that no earlier step used, so the daily job logs their dinners as soon as the server starts.
      const day = (back) => {
        const d = new Date(Date.now() - back * 86_400_000);
        return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
      };
      const used = new Set([D1, D2, D3, D4]);
      const [P1, P2] = [1, 2, 3, 4, 5, 6, 7].map(day).filter((d) => !used.has(d));
      const plan = await as("dsiw", () => web.startSession([P1, P2]));
      const eligible = await as("dsiw", () => web.fetchEligibleRecipes(plan.id));
      const [first, second] = eligible.recipes.filter((r) => !r.planAhead);
      const afterFirst = await as("dsiw", () => web.proposeRecipe(plan.id, eligible.date, first.id));
      // Nobody waits for an answer: the next day can be proposed at once, and a waiting dish is not offered again.
      const nextList = await as("dsiw", () => web.fetchEligibleRecipes(plan.id));
      assert.notEqual(nextList.date, eligible.date);
      assert.ok(!nextList.recipes.some((r) => r.id === first.id));
      const both = await as("dsiw", () => web.proposeRecipe(plan.id, nextList.date, second.id));
      assert.equal(both.proposals.filter((p) => p.status === "pending").length, 2);
      for (const p of both.proposals.filter((q) => q.status === "pending")) {
        await as("ac", () => web.acceptProposal(plan.id, p.id));
      }
      const done = await as("dsiw", () => web.finalizePlan(plan.id));
      assert.equal(done.status, "finalized");
      assert.equal(afterFirst.proposals.length, 1);

      // A finished plan still holds its dates: a new plan on them is refused at once.
      const refused = await as("ac", () => web.startSession([P1, P2]).catch((e) => e));
      assert.equal(refused.reason, "date_already_taken");
      assert.deepEqual(
        (await as("ac", () => web.fetchPlannedDates())).filter((d) => d.date === P1 || d.date === P2),
        [],
        "past days are no longer listed",
      );

      // The daily job runs when the server starts: yesterday's dinners become questions.
      await stopServer();
      await startServer(kitchenowlPort);
      const log = await as("ac", () => web.fetchMealLog(14));
      const asked = log.filter((e) => e.source === "from_plan" && !e.confirmed && (e.date === P1 || e.date === P2));
      assert.equal(asked.length, 2);
      const [a, b] = asked;
      assert.equal((await as("ac", () => web.confirmMeal(a.id))).entry.confirmed, true);
      assert.equal((await as("dsiw", () => web.confirmMeal(a.id).catch((e) => e))).reason, "already_confirmed");
      await as("dsiw", () => web.notCooked(b.id));
      assert.ok(!(await as("dsiw", () => web.fetchMealLog(14))).some((e) => e.id === b.id));
      const added = await as("dsiw", () => web.addMeal(day(0), "bread", null));
      assert.deepEqual([added.entry.base, added.entry.recipe, added.entry.source], ["bread", null, "added"]);
      const recipes = await as("ac", () => web.fetchRecipes());
      const fixed = await as("ac", () => web.correctMeal(added.entry.id, "rice", recipes[0].id));
      assert.deepEqual([fixed.entry.source, fixed.entry.recipe.id], ["corrected", recipes[0].id]);
      const future = await as("ac", () => web.addMeal(day(-2), "pasta", null).catch((e) => e));
      assert.equal(future.reason, "date_in_future");
      // Another start does not bring a removed dinner back.
      await stopServer();
      await startServer(kitchenowlPort);
      assert.ok(
        !(await as("ac", () => web.fetchMealLog(14))).some((e) => e.date === b.date && e.source === "from_plan"),
      );
    },
  );

  await step(
    "a dinner taken off KitchenOwl's planner frees its date again, and the icon font is passed on",
    async () => {
      const [M, T] = ["2026-12-07", "2026-12-08"];
      const plan = await as("dsiw", () => web.startSession([M, T]));
      for (let i = 0; i < 2; i++) {
        const eligible = await as("dsiw", () => web.fetchEligibleRecipes(plan.id));
        const recipe = eligible.recipes.find((r) => !r.planAhead);
        const proposed = await as("dsiw", () => web.proposeRecipe(plan.id, eligible.date, recipe.id));
        await as("ac", () => web.acceptProposal(plan.id, proposed.proposals.find((p) => p.status === "pending").id));
      }
      plannerHolds.length = 0;
      await as("dsiw", () => web.finalizePlan(plan.id));
      const held = (await as("ac", () => web.fetchPlannedDates())).filter((t) => t.date === M || t.date === T);
      assert.deepEqual(
        held.map((t) => t.date),
        [M, T],
      );
      assert.ok(
        held.every((t) => t.recipeName.length > 0),
        "the form can say which dinner holds a date",
      );
      plannerHolds.length = 0; // someone removed both dinners in KitchenOwl
      assert.deepEqual(
        (await as("ac", () => web.fetchPlannedDates())).filter((t) => t.date === M || t.date === T),
        [],
      );
      const again = await as("ac", () => web.startSession([M, T]));
      assert.equal(again.status, "open");
      await as("ac", () => web.closeSession(again.id));

      const font = await as("ac", () => fetch("/plan/api/item-icons"));
      assert.equal(font.status, 200);
      assert.deepEqual([...new Uint8Array(await font.arrayBuffer())], [0, 1, 0, 0]);
      assert.equal((await as("nobody", () => fetch("/plan/api/item-icons"))).status, 401);
    },
  );

  await step("a phone subscribes to notifications with the server's own key and unsubscribes again", async () => {
    const cookie = [...jars.get("ac")].map(([k, v]) => `${k}=${v}`).join("; ");
    const call = (method, path, body) =>
      realFetch(`${origin()}/plan/api${path}`, {
        method,
        headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const { key } = await (await call("GET", "/push/key")).json();
    assert.match(key, /^[A-Za-z0-9_-]{87}$/, "an uncompressed P-256 public key, base64url");
    const phone = { endpoint: "https://push.example/smoke", keys: { p256dh: "pk", auth: "au" } };
    assert.equal((await call("POST", "/push/subscription", phone)).status, 204);
    assert.equal((await call("DELETE", "/push/subscription", { endpoint: phone.endpoint })).status, 204);
    assert.equal((await call("POST", "/push/subscription", { endpoint: "nope" })).status, 400);
  });

  await step("a pasted recipe becomes a checked draft, and a recipe in KitchenOwl only once confirmed", async () => {
    const cookie = [...jars.get("ac")].map(([k, v]) => `${k}=${v}`).join("; ");
    const call = (path, body) =>
      realFetch(`${origin()}/plan/api${path}`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const res = await call("/import/draft", {
      text: "Linsensuppe: 200 g Linsen, 1 Bund Petersilie. Linsen waschen, kochen.",
    });
    assert.equal(res.status, 200);
    const { draft } = await res.json();
    assert.deepEqual(
      draft.ingredients.map((i) => [i.name, i.isNewItem]),
      [
        ["Linsen", false],
        ["Petersilie frisch", true],
      ],
      "an ingredient takes the household's name, markup and links are gone",
    );
    assert.deepEqual(draft.tags, ["🍲 Suppe"], "a tag the household does not have is dropped");
    assert.equal(draft.visibility, undefined, "whatever else the model said is dropped");
    assert.equal(imported.recipes.length, 0, "nothing is created before the member confirms");
    assert.equal(imported.llm[0].auth, "Bearer llm-key");
    assert.ok(
      !JSON.stringify(imported.llm[0].body.messages[0]).includes("Wärmt"),
      "the source is not in the instructions",
    );

    const created = await call("/import/create", { draft });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).recipeId, 901);
    assert.equal(imported.recipes.length, 1);
    assert.deepEqual(imported.recipes[0].tags, ["🍽️ Hauptgericht", "🌱 Vegan", "🆕 Neu", "🍲 Suppe"]);
    assert.equal(imported.recipes[0].description, "_Wärmt von innen_\n\n1. Linsen waschen.\n2. Kochen.");
    assert.equal(imported.recipes[0].visibility, 0);

    const own = await call("/import/draft", { address: "http://127.0.0.1/admin" });
    assert.equal(own.status, 422);
    assert.deepEqual(await own.json(), { error: "address_not_public" });
    assert.equal(imported.llm.length, 1, "a refused address never reaches the model");
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
    assert.match(serverLog, /\/withdraw -> 403 not_your_proposal/);
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
