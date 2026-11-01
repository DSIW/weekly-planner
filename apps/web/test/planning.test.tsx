import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, dayRows, findDayRows, renderApp, server } from "./helpers";

const ME = `GET ${api}/me`;
const CURRENT = `GET ${api}/sessions/current`;
const START = `POST ${api}/sessions`;
const CLOSE = `POST ${api}/sessions/s1/close`;
const max = { id: "2", name: "Max" };
const signedIn = { [ME]: { status: 200, body: { member: max } } };

const open = (dates: string[]) => ({
  id: "s1",
  status: "open",
  startedBy: "2",
  days: dates.map((date) => ({ date, status: "open" })),
  proposals: [],
});

/** Stands in for the browser's EventSource so a test can play the part of the other phone's changes. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  private readonly listeners = new Map<string, (() => void)[]>();
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string) {
    for (const l of this.listeners.get(type) ?? []) l();
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 1, 12)); // Sunday 1 November 2026
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("dates that already hold a dinner", () => {
  const PLANNED = `GET ${api}/planned-dates`;

  it("are shown in the form but cannot be picked, with the reason", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: null } },
      [PLANNED]: { status: 200, body: { dates: [{ date: "2026-11-03", recipeName: "Pasta" }] } },
    });
    renderApp();
    const taken = await screen.findByRole("button", { name: /3\.11\./ });
    await waitFor(() => expect(taken).toBeDisabled());
    expect(taken).toHaveAttribute("title", "Hier ist schon ein Essen geplant: Pasta");
    expect(taken).toHaveTextContent("Pasta");
    expect(screen.getByRole("button", { name: /2\.11\./ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /4\.11\./ })).toBeEnabled();
  });

  it("do not block the form when the list of them cannot be loaded", async () => {
    server({ ...signedIn, [CURRENT]: { status: 200, body: { session: null } }, [PLANNED]: { status: 500, body: {} } });
    renderApp();
    expect(await screen.findByRole("button", { name: /3\.11\./ })).toBeEnabled();
  });

  it("explain a refused start by the other plan", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: null } },
      [START]: { status: 409, body: { error: "date_already_taken" } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: /2\.11\./ }));
    await userEvent.click(screen.getByRole("button", { name: /3\.11\./ }));
    await userEvent.click(screen.getByRole("button", { name: "Planung starten" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("schon ein Essen geplant, in einer anderen Planung");
  });
});

describe("starting a session", () => {
  it("offers the next seven days and needs one to five of them", async () => {
    server({ ...signedIn, [CURRENT]: { status: 200, body: { session: null } } });
    renderApp();
    const start = await screen.findByRole("button", { name: "Planung starten" });
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(9); // seven days and the Verlauf and Import tabs
    expect(start).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /^Mo.*2\.11\./ }));
    expect(start).toBeEnabled();
    for (const name of [/^Di.*3\.11\./, /^Mi.*4\.11\./, /^Do.*5\.11\./, /^Fr.*6\.11\./, /^Sa.*7\.11\./])
      await userEvent.click(screen.getByRole("button", { name })); // a sixth is ignored
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(6); // five days and the Planung tab
  });

  it("sends the chosen dates in order and then shows the board", async () => {
    let session: unknown = null;
    const calls = server({
      ...signedIn,
      [CURRENT]: () => ({ status: 200, body: { session } }),
      [START]: () => {
        session = open(["2026-11-02", "2026-11-03"]);
        return { status: 201, body: { session } };
      },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: /^Di.*3\.11\./ }));
    await userEvent.click(screen.getByRole("button", { name: /^Mo.*2\.11\./ }));
    await userEvent.click(screen.getByRole("button", { name: "Planung starten" }));
    expect(await screen.findByRole("heading", { name: "Planung" })).toBeInTheDocument();
    expect(calls.find((c) => c.key === START)?.body).toEqual({ dates: ["2026-11-02", "2026-11-03"] });
    expect(dayRows()).toHaveLength(2);
  });

  it("explains that a planning is already running and shows it", async () => {
    let session: unknown = null;
    server({
      ...signedIn,
      [CURRENT]: () => ({ status: 200, body: { session } }),
      [START]: () => {
        session = open(["2026-11-04", "2026-11-05"]); // the other member was faster
        return { status: 409, body: { error: "session_already_open" } };
      },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: /^Mo.*2\.11\./ }));
    await userEvent.click(screen.getByRole("button", { name: /^Di.*3\.11\./ }));
    await userEvent.click(screen.getByRole("button", { name: "Planung starten" }));
    expect(await screen.findByRole("heading", { name: "Planung" })).toBeInTheDocument();
    expect(dayRows()).toHaveLength(2);
  });
});

describe("the shared board", () => {
  it("shows the open session with its days", async () => {
    server({ ...signedIn, [CURRENT]: { status: 200, body: { session: open(["2026-11-02", "2026-11-03"]) } } });
    renderApp();
    const days = await findDayRows();
    expect(days[0]).toHaveTextContent(/Mo.*2\.11\..*Als Nächstes dran/);
    expect(days[1]).toHaveTextContent(/Di.*3\.11\..*noch offen/);
  });

  it("discards the session and offers a new one", async () => {
    let session: unknown = open(["2026-11-02", "2026-11-03"]);
    const calls = server({
      ...signedIn,
      [CURRENT]: () => ({ status: 200, body: { session } }),
      [CLOSE]: () => {
        session = null;
        return { status: 200, body: { session: { ...(open([]) as object), status: "closed" } } };
      },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Planung verwerfen" }));
    expect(await screen.findByRole("button", { name: "Planung starten" })).toBeInTheDocument();
    expect(calls.some((c) => c.key === CLOSE)).toBe(true);
  });

  it("sends the close request without a JSON content type, because it has no body (the server rejects that combination)", async () => {
    let session: unknown = open(["2026-11-02", "2026-11-03"]);
    const calls = server({
      ...signedIn,
      [CURRENT]: () => ({ status: 200, body: { session } }),
      [CLOSE]: () => {
        session = null;
        return { status: 200, body: { session: open([]) } };
      },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Planung verwerfen" }));
    await screen.findByRole("button", { name: "Planung starten" });
    const headers = new Headers(calls.find((c) => c.key === CLOSE)?.headers);
    expect(headers.has("content-type")).toBe(false);
  });

  it("says so when discarding fails, instead of doing nothing", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: open(["2026-11-02", "2026-11-03"]) } },
      [CLOSE]: { status: 500, body: {} },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Planung verwerfen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
    expect(screen.getByRole("heading", { name: "Planung" })).toBeInTheDocument();
  });

  it("follows the other member live: a started session appears without a reload", async () => {
    let session: unknown = null;
    server({ ...signedIn, [CURRENT]: () => ({ status: 200, body: { session } }) });
    renderApp();
    expect(await screen.findByRole("button", { name: "Planung starten" })).toBeInTheDocument();
    const stream = FakeEventSource.instances[0]!;
    expect(stream.url).toBe(`${api}/events`);

    session = open(["2026-11-02", "2026-11-03"]); // the other phone started it
    stream.emit("changed");
    expect(await screen.findByRole("heading", { name: "Planung" })).toBeInTheDocument();

    session = null; // ...and discarded it again
    stream.emit("changed");
    expect(await screen.findByRole("button", { name: "Planung starten" })).toBeInTheDocument();
  });

  it("refreshes the meal log too when the other phone changed something", async () => {
    const LOG = `GET ${api}/meal-log?days=14`;
    const calls = server({ ...signedIn, [CURRENT]: { status: 200, body: { session: null } } });
    renderApp();
    await screen.findByRole("button", { name: "Planung starten" });
    await waitFor(() => expect(calls.filter((c) => c.key === LOG).length).toBeGreaterThan(0));
    const before = calls.filter((c) => c.key === LOG).length;
    FakeEventSource.instances[0]!.emit("changed");
    await waitFor(() => expect(calls.filter((c) => c.key === LOG).length).toBeGreaterThan(before));
  });

  it("refetches when the stream reconnects, because changes in between were missed", async () => {
    let session: unknown = null;
    const calls = server({ ...signedIn, [CURRENT]: () => ({ status: 200, body: { session } }) });
    renderApp();
    await screen.findByRole("button", { name: "Planung starten" });
    const before = calls.filter((c) => c.key === CURRENT).length;
    session = open(["2026-11-02", "2026-11-03"]);
    FakeEventSource.instances[0]!.emit("ready");
    await waitFor(() => expect(calls.filter((c) => c.key === CURRENT).length).toBeGreaterThan(before));
    expect(await screen.findByRole("heading", { name: "Planung" })).toBeInTheDocument();
  });

  it("stops listening when the member signs out", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: null } },
      [`POST ${api}/logout`]: { status: 204 },
    });
    renderApp();
    await screen.findByRole("button", { name: "Planung starten" });
    await userEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    await screen.findByLabelText("Benutzername");
    expect(FakeEventSource.instances.every((s) => s.closed)).toBe(true);
  });
});

// Every action a member can take must say so when it fails; a silent failure looks like a broken button.
describe("failed actions are visible", () => {
  const LOGIN = `POST ${api}/login`;
  const LOGOUT = `POST ${api}/logout`;

  it("login that the server fails on", async () => {
    server({ [ME]: { status: 401 }, [LOGIN]: { status: 500, body: {} } });
    renderApp();
    await userEvent.type(await screen.findByLabelText("Benutzername"), "x");
    await userEvent.type(screen.getByLabelText("Passwort"), "y");
    await userEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht erreichbar");
  });

  it("starting a session that the server fails on", async () => {
    server({ ...signedIn, [CURRENT]: { status: 200, body: { session: null } }, [START]: { status: 500, body: {} } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: /^Mo.*2\.11\./ }));
    await userEvent.click(screen.getByRole("button", { name: /^Di.*3\.11\./ }));
    await userEvent.click(screen.getByRole("button", { name: "Planung starten" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("discarding a session that the server fails on", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: open(["2026-11-02", "2026-11-03"]) } },
      [CLOSE]: { status: 500, body: {} },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Planung verwerfen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("signing out that fails, and the member stays signed in", async () => {
    server({ ...signedIn, [CURRENT]: { status: 200, body: { session: null } }, [LOGOUT]: { status: 500, body: {} } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Abmelden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Abmelden");
    expect(screen.getByRole("heading", { name: "Hallo, Max" })).toBeInTheDocument();
  });

  it("loading the session that the server fails on", async () => {
    server({ ...signedIn, [CURRENT]: { status: 500, body: {} } });
    renderApp();
    expect(await screen.findByText(/konnte nicht geladen werden/)).toBeInTheDocument();
  });
});
