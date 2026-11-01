import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchPage, isPublicAddress } from "../../../src/infrastructure/import/safe-fetch.js";
import { WebRecipeSource } from "../../../src/infrastructure/import/web-recipe-source.js";

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.15.0.1",
    "172.32.0.1",
    "100.63.0.1",
    "100.128.0.1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "2002:0808:0808::1",
  ])("lets %s through", (ip) => expect(isPublicAddress(ip)).toBe(true));

  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "192.0.2.1",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "64:ff9b::7f00:1",
    "2002:7f00:0001::1",
    "::127.0.0.1",
    "not an address",
    "",
    "999.1.1.1",
    "1:2:3",
  ])("keeps %s out", (ip) => expect(isPublicAddress(ip)).toBe(false));
});

const limits = { maxBytes: 5000, timeoutMs: 2000, maxRedirects: 3 };
let server: http.Server;
let base: string;
const open = { allowed: () => true, allowedPort: () => true };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    const html = (body: string, type = "text/html; charset=utf-8") => {
      res.writeHead(200, { "content-type": type });
      res.end(body);
    };
    if (url === "/ok") return html("<p>Hallo Käse</p>");
    if (url === "/latin") {
      res.writeHead(200, { "content-type": "text/html; charset=iso-8859-1" });
      return res.end(Buffer.from("<p>K\xe4se</p>", "latin1"));
    }
    if (url === "/json") return html("{}", "application/json");
    if (url === "/big") return html("x".repeat(6000));
    if (url === "/missing") {
      res.writeHead(404);
      return res.end("no");
    }
    if (url === "/r1") {
      res.writeHead(302, { location: "/r2" });
      return res.end();
    }
    if (url === "/r2") {
      res.writeHead(301, { location: "/ok" });
      return res.end();
    }
    if (url === "/loop") {
      res.writeHead(302, { location: "/loop" });
      return res.end();
    }
    if (url === "/to-private") {
      res.writeHead(302, { location: "http://10.0.0.1/secret" });
      return res.end();
    }
    if (url === "/slow") return void setTimeout(() => html("late"), 3000);
    if (url === "/empty") return html("<script>only code</script>");
    res.writeHead(500);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("fetchPage", () => {
  it("reads a page, in the charset it says", async () => {
    expect(await fetchPage(`${base}/ok`, { ...limits, ...open })).toEqual({ ok: true, html: "<p>Hallo Käse</p>" });
    expect(await fetchPage(`${base}/latin`, { ...limits, ...open })).toEqual({ ok: true, html: "<p>Käse</p>" });
  });

  it("follows redirects up to the limit, and gives up on a loop", async () => {
    expect(await fetchPage(`${base}/r1`, { ...limits, ...open })).toEqual({ ok: true, html: "<p>Hallo Käse</p>" });
    expect(await fetchPage(`${base}/r1`, { ...limits, ...open, maxRedirects: 1 })).toEqual({
      ok: false,
      reason: "unreachable",
    });
    expect(await fetchPage(`${base}/loop`, { ...limits, ...open })).toEqual({ ok: false, reason: "unreachable" });
  });

  it("refuses what is not a page, too much, an error status and a slow server", async () => {
    expect(await fetchPage(`${base}/json`, { ...limits, ...open })).toEqual({ ok: false, reason: "not_a_page" });
    expect(await fetchPage(`${base}/big`, { ...limits, ...open })).toEqual({ ok: false, reason: "too_large" });
    expect(await fetchPage(`${base}/missing`, { ...limits, ...open })).toEqual({ ok: false, reason: "unreachable" });
    expect(await fetchPage(`${base}/slow`, { ...limits, ...open, timeoutMs: 300 })).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("does not connect to the machine itself or the home network, not even by a redirect", async () => {
    expect(await fetchPage(`${base}/ok`, { ...limits, allowedPort: () => true })).toEqual({
      ok: false,
      reason: "address_not_public",
    });
    expect(await fetchPage("http://[::1]/", limits)).toEqual({ ok: false, reason: "address_not_public" });
    expect(await fetchPage("http://192.168.1.10/admin", limits)).toEqual({ ok: false, reason: "address_not_public" });
    expect(await fetchPage("http://localhost/", limits)).toEqual({ ok: false, reason: "address_not_public" });
    // The first hop is allowed here; the address it redirects to is not.
    const viaRedirect = await fetchPage(`${base}/to-private`, {
      ...limits,
      allowedPort: () => true,
      allowed: (ip) => ip === "127.0.0.1",
    });
    expect(viaRedirect).toEqual({ ok: false, reason: "address_not_public" });
  });

  it("refuses addresses that are not plain http or https links on the default port", async () => {
    for (const bad of [
      "ftp://example.org/x",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://user:pass@example.org/",
      "http://example.org:8080/",
      "https://example.org:22/",
      "not a url",
      "",
    ])
      expect(await fetchPage(bad, limits), bad).toEqual({ ok: false, reason: "invalid_address" });
  });
});

describe("WebRecipeSource", () => {
  const source = new WebRecipeSource({ ...open, ...limits });

  it("gives the text of a page", async () => {
    expect(await source.read(`${base}/ok`)).toEqual({ ok: true, text: "Hallo Käse" });
  });

  it("says when a page has no text, and passes failures on", async () => {
    expect(await source.read(`${base}/empty`)).toEqual({ ok: false, reason: "empty" });
    expect(await source.read(`${base}/json`)).toEqual({ ok: false, reason: "not_a_page" });
    expect(await new WebRecipeSource({ allowedPort: () => true }).read(`${base}/ok`)).toEqual({
      ok: false,
      reason: "address_not_public",
    });
  });
});
