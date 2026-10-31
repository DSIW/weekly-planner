import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, renderApp, server } from "./helpers";

const ME = `GET ${api}/me`;
const LOGIN = `POST ${api}/login`;
const LOGOUT = `POST ${api}/logout`;
const max = { id: "2", name: "Max" };

afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("greets a member who is already signed in", async () => {
    server({ [ME]: { status: 200, body: { member: max } } });
    renderApp();
    expect(await screen.findByRole("heading", { name: "Hallo, Max" })).toBeInTheDocument();
  });

  it("shows the sign-in form when nobody is signed in and greets after a successful sign-in", async () => {
    const calls = server({ [ME]: { status: 401 }, [LOGIN]: { status: 200, body: { member: max } } });
    renderApp();
    await userEvent.type(await screen.findByLabelText("Benutzername"), "dsiw");
    await userEvent.type(screen.getByLabelText("Passwort"), "geheim");
    await userEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByRole("heading", { name: "Hallo, Max" })).toBeInTheDocument();
    expect(calls.find((c) => c.key === LOGIN)?.body).toEqual({ username: "dsiw", password: "geheim" });
  });

  it.each([
    [401, "invalid_credentials", "Benutzername oder Passwort stimmt nicht."],
    [403, "not_in_household", "Dieses Konto gehört nicht zum Haushalt."],
  ])("explains a refused sign-in (%s)", async (status, error, message) => {
    server({ [ME]: { status: 401 }, [LOGIN]: { status, body: { error } } });
    renderApp();
    await userEvent.type(await screen.findByLabelText("Benutzername"), "x");
    await userEvent.type(screen.getByLabelText("Passwort"), "y");
    await userEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("heading", { name: /Hallo/ })).not.toBeInTheDocument();
  });

  it("signs out and shows the form again", async () => {
    server({ [ME]: { status: 200, body: { member: max } }, [LOGOUT]: { status: 204 } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Abmelden" }));
    expect(await screen.findByLabelText("Benutzername")).toBeInTheDocument();
  });

  it("says so when the server cannot be reached", async () => {
    server({ [ME]: { status: 500 } });
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht erreichbar");
  });
});
