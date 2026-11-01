import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, renderApp, server } from "./helpers";

const ME = `GET ${api}/me`;
const CURRENT = `GET ${api}/sessions/current`;
const KEY = `GET ${api}/push/key`;
const SUBSCRIBE = `POST ${api}/push/subscription`;
const TEST = `POST ${api}/push/test`;
const UNSUBSCRIBE = `DELETE ${api}/push/subscription`;
const base = {
  [ME]: { status: 200, body: { member: { id: "2", name: "Max" } } },
  [CURRENT]: { status: 200, body: { session: null } },
};
const subscriptionJson = { endpoint: "https://push.example/abc", keys: { p256dh: "pk", auth: "au" } };

/** A phone that supports notifications; `subscribed` says whether it already is subscribed. */
function phone(subscribed: boolean, permission: NotificationPermission = "granted") {
  let current: { toJSON: () => unknown; unsubscribe: () => Promise<boolean>; endpoint: string } | null = null;
  const made = () => ({
    endpoint: subscriptionJson.endpoint,
    toJSON: () => subscriptionJson,
    unsubscribe: vi.fn(async () => {
      current = null;
      return true;
    }),
  });
  if (subscribed) current = made();
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async (_options: unknown) => (current = made())),
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  vi.stubGlobal("PushManager", class {});
  const requestPermission = vi.fn(async () => permission);
  vi.stubGlobal("Notification", { requestPermission });
  return { pushManager, requestPermission, current: () => current };
}

beforeEach(() => vi.stubGlobal("EventSource", undefined));
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(navigator, "standalone");
});

describe("notifications switch", () => {
  it("shows nothing where notifications cannot work", async () => {
    server(base);
    renderApp();
    await screen.findByText(/Hallo, Max/);
    expect(screen.queryByRole("button", { name: /Benachrichtigungen/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Home-Bildschirm/)).not.toBeInTheDocument();
  });

  it("shows nothing in a browser that has a service worker but no Push API", async () => {
    const p = phone(false);
    vi.stubGlobal("PushManager", undefined);
    Reflect.deleteProperty(window, "PushManager");
    server(base);
    renderApp();
    await screen.findByText(/Hallo, Max/);
    await new Promise((resolve) => setTimeout(resolve, 100)); // a switch would appear once the state is read
    expect(p.pushManager.getSubscription).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Benachrichtigungen/ })).not.toBeInTheDocument();
  });

  it("tells an iPhone in a browser tab to add the app to the home screen first", async () => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: false });
    server(base);
    renderApp();
    expect(await screen.findByText(/zum Home-Bildschirm hinzufügen/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Benachrichtigungen/ })).not.toBeInTheDocument();
  });

  it("subscribes this phone with the server's key and tells the server where to reach it", async () => {
    const p = phone(false);
    const calls = server({
      ...base,
      [KEY]: { status: 200, body: { key: "-_8" } }, // base64url for the two bytes 251, 255
      [SUBSCRIBE]: { status: 204 },
      [TEST]: { status: 200, body: { reached: 1 } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Benachrichtigungen an" }));
    expect(await screen.findByRole("button", { name: "Benachrichtigungen aus" })).toBeInTheDocument();
    const options = p.pushManager.subscribe.mock.calls[0]?.[0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(options.userVisibleOnly).toBe(true);
    expect(Array.from(options.applicationServerKey)).toEqual([251, 255]);
    expect(calls.find((c) => c.key === SUBSCRIBE)?.body).toEqual(subscriptionJson);
    expect(calls.map((c) => c.key).filter((k) => k === TEST || k === SUBSCRIBE)).toEqual([SUBSCRIBE, TEST]); // test after
  });

  it("still turns on when the test message cannot be sent", async () => {
    phone(false);
    server({
      ...base,
      [KEY]: { status: 200, body: { key: "AQID" } },
      [SUBSCRIBE]: { status: 204 },
      [TEST]: { status: 500 },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Benachrichtigungen an" }));
    expect(await screen.findByRole("button", { name: "Benachrichtigungen aus" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("is a bell in the header, not a labelled button in the page", async () => {
    phone(true);
    server(base);
    renderApp();
    const bell = await screen.findByRole("button", { name: "Benachrichtigungen aus" });
    expect(bell.closest("header")).not.toBeNull();
    expect(bell).toHaveTextContent("🔔");
    expect(bell).not.toHaveTextContent("Benachrichtigungen");
  });

  it("does not subscribe when the member refuses permission, and says how to allow it", async () => {
    const p = phone(false, "denied");
    const calls = server(base);
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Benachrichtigungen an" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("blockiert");
    expect(p.pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls.some((c) => c.key === KEY)).toBe(false);
  });

  it("gives the subscription back when the server could not store it, so the phone is not left half way", async () => {
    const p = phone(false);
    server({ ...base, [KEY]: { status: 200, body: { key: "AQID" } }, [SUBSCRIBE]: { status: 500 } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Benachrichtigungen an" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
    expect(p.current()).toBeNull();
    expect(screen.getByRole("button", { name: "Benachrichtigungen an" })).toBeInTheDocument();
  });

  it("reports a failure to fetch the key", async () => {
    const p = phone(false);
    server({ ...base, [KEY]: { status: 500 } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Benachrichtigungen an" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
    expect(p.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("turns off: unsubscribes the phone and tells the server to forget it", async () => {
    const p = phone(true);
    const calls = server({ ...base, [UNSUBSCRIBE]: { status: 204 } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Benachrichtigungen aus" }));
    expect(await screen.findByRole("button", { name: "Benachrichtigungen an" })).toBeInTheDocument();
    expect(p.current()).toBeNull();
    await waitFor(() =>
      expect(calls.find((c) => c.key === UNSUBSCRIBE)?.body).toEqual({ endpoint: subscriptionJson.endpoint }),
    );
  });

  it("still turns on when the test message does not even reach the server", async () => {
    phone(false);
    server({ ...base, [KEY]: { status: 200, body: { key: "AQID" } }, [SUBSCRIBE]: { status: 204 } });
    const reply = vi.mocked(fetch);
    const original = reply.getMockImplementation()!;
    reply.mockImplementation(async (url, init) => {
      if (`${init?.method ?? "GET"} ${String(url)}` === TEST) throw new TypeError("Failed to fetch");
      return original(url, init);
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Benachrichtigungen an" }));
    expect(await screen.findByRole("button", { name: "Benachrichtigungen aus" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends no test message when turning off", async () => {
    phone(true);
    const calls = server({ ...base, [UNSUBSCRIBE]: { status: 204 }, [TEST]: { status: 200, body: { reached: 1 } } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Benachrichtigungen aus" }));
    expect(await screen.findByRole("button", { name: "Benachrichtigungen an" })).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.key === UNSUBSCRIBE)).toBe(true));
    expect(calls.some((c) => c.key === TEST)).toBe(false);
  });
});
