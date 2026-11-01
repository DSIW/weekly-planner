const base = `${import.meta.env.BASE_URL}api`;

/** Why notifications could not be turned on. */
export class PushFailed extends Error {
  constructor(readonly reason: "denied" | "unavailable") {
    super(reason);
  }
}

/** Notifications need a service worker, the Push API and the Notification API (on iPhone: the installed app). */
export const pushSupported = (): boolean =>
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  typeof window !== "undefined" &&
  "PushManager" in window &&
  "Notification" in window;

/** An iPhone in a Safari tab: notifications only work once the app was added to the home screen. */
export const needsInstalling = (): boolean =>
  typeof navigator !== "undefined" && (navigator as { standalone?: boolean }).standalone === false;

const registration = () => navigator.serviceWorker.ready;

/** Whether this phone is subscribed right now. */
export async function isSubscribed(): Promise<boolean> {
  return (await (await registration()).pushManager.getSubscription()) !== null;
}

/** The server's key arrives base64url encoded; the Push API wants the bytes. */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const padded = key
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(key.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function send(method: "POST" | "DELETE", path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Asks for permission, subscribes this phone and tells the server where to reach it. */
export async function enablePush(): Promise<void> {
  if ((await Notification.requestPermission()) !== "granted") throw new PushFailed("denied");
  try {
    const keyRes = await fetch(`${base}/push/key`, { credentials: "same-origin" });
    if (!keyRes.ok) throw new Error(`HTTP ${keyRes.status}`);
    const { key } = (await keyRes.json()) as { key: string };
    const subscription = await (await registration()).pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    });
    const res = await send("POST", "/push/subscription", subscription.toJSON());
    if (!res.ok) {
      await subscription.unsubscribe();
      throw new Error(`HTTP ${res.status}`);
    }
  } catch {
    throw new PushFailed("unavailable");
  }
  // A first message right away shows that it works; if it does not arrive, nothing is lost by trying.
  await send("POST", "/push/test", {}).catch(() => undefined);
}

/** Unsubscribes this phone and tells the server to forget it. */
export async function disablePush(): Promise<void> {
  const subscription = await (await registration()).pushManager.getSubscription();
  if (!subscription) return;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  await send("DELETE", "/push/subscription", { endpoint });
}
