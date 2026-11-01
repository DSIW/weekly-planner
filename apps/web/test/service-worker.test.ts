import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

type Listener = (event: unknown) => void;

/** Runs public/sw.js against a stand-in for the service worker scope and returns what it registered. */
function load() {
  const listeners = new Map<string, Listener>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const windows: { url: string; focus: ReturnType<typeof vi.fn> }[] = [];
  const opened: string[] = [];
  const scope = {
    registration: {
      scope: "https://home.example/plan/",
      showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      }),
    },
    addEventListener: (type: string, l: Listener) => listeners.set(type, l),
    location: new URL("https://home.example/plan/sw.js"),
    clients: {
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async (url: string) => {
        opened.push(url);
      }),
    },
  };
  const source = readFileSync(join(import.meta.dirname, "../public/sw.js"), "utf8");
  new Function("self", "location", "clients", "caches", "URL", source)(scope, scope.location, scope.clients, {}, URL);
  const waits: Promise<unknown>[] = [];
  const event = (extra: object) => ({ waitUntil: (p: Promise<unknown>) => waits.push(p), ...extra });
  return { listeners, shown, windows, opened, event, settle: () => Promise.all(waits) };
}

describe("service worker notifications", () => {
  it("shows the reminder the server pushed, even though the app is closed", async () => {
    const sw = load();
    sw.listeners.get("push")?.(
      sw.event({ data: { json: () => ({ title: "Wochenplan", body: "Plan abschließen", url: "/plan/" }) } }),
    );
    await sw.settle();
    expect(sw.shown).toEqual([
      {
        title: "Wochenplan",
        options: {
          body: "Plan abschließen",
          icon: "/plan/icon-192.png",
          tag: "finalize-reminder",
          data: { url: "/plan/" },
        },
      },
    ]);
  });

  it("still shows something for a push without content", async () => {
    const sw = load();
    sw.listeners.get("push")?.(sw.event({ data: null }));
    await sw.settle();
    expect(sw.shown[0]?.title).toBe("Wochenplan");
    expect(sw.shown[0]?.options).toMatchObject({ body: "", data: { url: "/plan/" } });
  });

  it("brings an open app forward when the notification is tapped", async () => {
    const sw = load();
    const focus = vi.fn(async () => {});
    sw.windows.push({ url: "https://home.example/plan/", focus });
    const close = vi.fn();
    sw.listeners.get("notificationclick")?.(sw.event({ notification: { close, data: { url: "/plan/" } } }));
    await sw.settle();
    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(sw.opened).toEqual([]);
  });

  it("opens the app when it is not open, and ignores other pages of the same site", async () => {
    const sw = load();
    const other = vi.fn(async () => {});
    sw.windows.push({ url: "https://home.example/kitchenowl/", focus: other });
    sw.listeners.get("notificationclick")?.(sw.event({ notification: { close: () => {}, data: { url: "/plan/" } } }));
    await sw.settle();
    expect(other).not.toHaveBeenCalled();
    expect(sw.opened).toEqual(["https://home.example/plan/"]);
  });

  it("falls back to the app's own address when the notification carries none", async () => {
    const sw = load();
    sw.listeners.get("notificationclick")?.(sw.event({ notification: { close: () => {}, data: undefined } }));
    await sw.settle();
    expect(sw.opened).toEqual(["https://home.example/plan/"]);
  });
});
