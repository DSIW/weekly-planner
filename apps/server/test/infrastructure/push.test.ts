import type { PushSubscription } from "@weekly-planner/application";
import { memberId, type PlanningSession } from "@weekly-planner/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadOrCreateVapidKeys } from "../../src/infrastructure/push/vapid-keys.js";
import { WebPushNotifier } from "../../src/infrastructure/push/web-push-notifier.js";
import { openDatabase } from "../../src/infrastructure/sqlite/database.js";
import { SqlitePushSubscriptions } from "../../src/infrastructure/sqlite/sqlite-push-subscriptions.js";
import { startScheduler } from "../../src/infrastructure/scheduling/scheduler.js";

const MAX = memberId("2");
const AC = memberId("3");
const sub = (n: number): PushSubscription => ({
  endpoint: `https://push.example/${n}`,
  p256dh: `key${n}`,
  auth: `auth${n}`,
});
const session = {} as PlanningSession;
const clock = () => {
  let t = 0;
  return () => ++t;
};

describe("SqlitePushSubscriptions", () => {
  it("keeps one row per endpoint: subscribing again as someone else moves the phone to them", async () => {
    const store = new SqlitePushSubscriptions(openDatabase(":memory:"), clock());
    await store.save(MAX, sub(1));
    await store.save(AC, sub(2));
    await store.save(AC, { ...sub(1), p256dh: "rotated" });
    expect(await store.all()).toEqual([
      { member: AC, subscription: { ...sub(1), p256dh: "rotated" } },
      { member: AC, subscription: sub(2) },
    ]);
  });

  it("forgets a phone, and removing an unknown one is not an error", async () => {
    const store = new SqlitePushSubscriptions(openDatabase(":memory:"));
    await store.save(MAX, sub(1));
    await store.remove(sub(2).endpoint);
    await store.remove(sub(1).endpoint);
    expect(await store.all()).toEqual([]);
  });
});

describe("loadOrCreateVapidKeys", () => {
  it("makes the key pair once and hands back the same one afterwards", () => {
    const db = openDatabase(":memory:");
    let made = 0;
    const generate = () => ({ publicKey: `pub${++made}`, privateKey: `priv${made}` });
    expect(loadOrCreateVapidKeys(db, generate)).toEqual({ publicKey: "pub1", privateKey: "priv1" });
    expect(loadOrCreateVapidKeys(db, generate)).toEqual({ publicKey: "pub1", privateKey: "priv1" });
    expect(made).toBe(1);
  });
});

describe("WebPushNotifier", () => {
  const setup = (send: (s: PushSubscription, payload: string) => Promise<unknown>) => {
    const db = openDatabase(":memory:");
    const store = new SqlitePushSubscriptions(db);
    const log: string[] = [];
    return { store, log, notifier: new WebPushNotifier(store, send, "/plan/", (l) => log.push(l)) };
  };

  it("sends the reminder to every subscribed phone, with the address to open", async () => {
    const sent: { endpoint: string; payload: unknown }[] = [];
    const { store, notifier } = setup(async (s, payload) => {
      sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) });
    });
    await store.save(MAX, sub(1));
    await store.save(AC, sub(2));
    await notifier.finalizeReminder(session);
    expect(sent.map((s) => s.endpoint)).toEqual([sub(1).endpoint, sub(2).endpoint]);
    expect(sent[0]?.payload).toEqual({
      title: "Wochenplan",
      body: "Ihr habt Tage geplant, aber die Einkaufsliste ist noch nicht gefüllt.",
      url: "/plan/",
    });
  });

  it.each([404, 410])(
    "forgets a phone the push service reports as gone (HTTP %i) and still reaches the others",
    async (code) => {
      const reached: string[] = [];
      const { store, notifier, log } = setup(async (s) => {
        if (s.endpoint === sub(1).endpoint) throw Object.assign(new Error("gone"), { statusCode: code });
        reached.push(s.endpoint);
      });
      await store.save(MAX, sub(1));
      await store.save(AC, sub(2));
      await notifier.finalizeReminder(session);
      expect(reached).toEqual([sub(2).endpoint]);
      expect((await store.all()).map((r) => r.subscription.endpoint)).toEqual([sub(2).endpoint]);
      expect(log).toEqual([]);
    },
  );

  it.each([429, 500, undefined])(
    "keeps a phone after a failure that may pass (%s), logs it and goes on",
    async (code) => {
      const reached: string[] = [];
      const { store, notifier, log } = setup(async (s) => {
        if (s.endpoint === sub(1).endpoint) throw Object.assign(new Error("try later"), { statusCode: code });
        reached.push(s.endpoint);
      });
      await store.save(MAX, sub(1));
      await store.save(AC, sub(2));
      await expect(notifier.finalizeReminder(session)).resolves.toBeUndefined();
      expect(reached).toEqual([sub(2).endpoint]);
      expect(await store.all()).toHaveLength(2);
      expect(log).toEqual(["push to a phone failed: try later"]);
    },
  );

  it("tests one member's phones only, says how many took it, and still forgets a gone one", async () => {
    const sent: { endpoint: string; body: string }[] = [];
    const { store, notifier } = setup(async (s, payload) => {
      if (s.endpoint === sub(3).endpoint) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push({ endpoint: s.endpoint, body: JSON.parse(payload).body });
    });
    await store.save(MAX, sub(1));
    await store.save(AC, sub(2));
    await store.save(AC, sub(3));
    expect(await notifier.test(AC)).toBe(1);
    expect(sent).toEqual([
      { endpoint: sub(2).endpoint, body: "Benachrichtigungen sind an. So meldet sich der Wochenplan." },
    ]);
    expect((await store.all()).map((r) => r.subscription.endpoint)).not.toContain(sub(3).endpoint);
    expect(await notifier.test(memberId("9"))).toBe(0);
  });

  it("does nothing when nobody has subscribed", async () => {
    const send = vi.fn();
    const { notifier } = setup(send);
    await notifier.finalizeReminder(session);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("startScheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("runs a job at once and then at its interval, until stopped", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => 0);
    const stop = startScheduler([{ name: "a", everyMs: 1000, run }]);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2500);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("reports a failing job and keeps the others and the next tick going", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    let calls = 0;
    const flaky = vi.fn(async () => {
      if (++calls === 1) throw new Error("boom");
    });
    const other = vi.fn(async () => 0);
    const stop = startScheduler(
      [
        { name: "flaky", everyMs: 1000, run: flaky },
        { name: "other", everyMs: 1000, run: other },
      ],
      (l) => log.push(l),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(log).toEqual(["job flaky failed: boom"]);
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(2);
    stop();
  });

  it("never runs a job twice at the same time", async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((r) => (release = r)));
    const stop = startScheduler([{ name: "slow", everyMs: 1000, run }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
});
