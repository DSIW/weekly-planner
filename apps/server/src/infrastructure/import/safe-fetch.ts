import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import type { SourceFailure } from "@weekly-planner/application";

/** Groups of an IPv6 address, or null when it is not one. Handles "::", an embedded dotted IPv4 and a zone id. */
function parseIPv6(input: string): number[] | null {
  let ip = input.split("%")[0] ?? "";
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (dotted) {
    const parts = (dotted[1] as string).split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => !(p >= 0 && p <= 255))) return null;
    ip = `${ip.slice(0, -(dotted[1] as string).length)}${(((parts[0] as number) << 8) | (parts[1] as number)).toString(16)}:${(((parts[2] as number) << 8) | (parts[3] as number)).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = (halves[0] ?? "") === "" ? [] : (halves[0] as string).split(":");
  const tail = halves.length === 2 && (halves[1] ?? "") !== "" ? (halves[1] as string).split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((g) =>
    /^[0-9a-f]{1,4}$/i.test(g) ? Number.parseInt(g, 16) : Number.NaN,
  );
  return groups.length === 8 && groups.every((g) => Number.isInteger(g)) ? groups : null;
}

function isPublicIPv4(octets: readonly number[]): boolean {
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

/** True only for an address on the public internet: nothing of the machine itself, a home network or a reserved range. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPublicIPv4(ip.split(".").map(Number));
  if (kind !== 6) return false;
  const g = parseIPv6(ip);
  if (!g) return false;
  const v4 = (hi: number, lo: number) => isPublicIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4(g[6] as number, g[7] as number); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return false; // ::, ::1 and the deprecated IPv4-compatible form
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))
    return v4(g[6] as number, g[7] as number); // NAT64
  if (g[0] === 0x2002) return v4(g[1] as number, g[2] as number); // 6to4
  if (((g[0] as number) & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if (((g[0] as number) & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if (((g[0] as number) & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  return true;
}

export interface FetchLimits {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}

export type Page = { ok: true; html: string; url: string } | { ok: false; reason: SourceFailure };

type Body = { ok: true; body: Buffer; contentType: string; url: string } | { ok: false; reason: SourceFailure };

/** What a request asks for and which answers it accepts. */
interface Kind {
  accept: string;
  allows: (contentType: string) => boolean;
  /** The failure for an answer of another kind. */
  wrong: SourceFailure;
}

const PAGE: Kind = {
  accept: "text/html,application/xhtml+xml",
  allows: (t) => /^(text\/html|application\/xhtml\+xml)/i.test(t),
  wrong: "not_a_page",
};
const PICTURE: Kind = {
  accept: "image/jpeg,image/png,image/webp",
  allows: (t) => /^image\//i.test(t),
  wrong: "not_a_page",
};

interface Options extends FetchLimits {
  /** Which addresses may be connected to; public ones only, unless a test says otherwise. */
  allowed?: (ip: string) => boolean;
  /** Which port may be used; the protocol's default one only, unless a test says otherwise. */
  allowedPort?: (port: string, defaultPort: string) => boolean;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function decode(buffer: Buffer, contentType: string): string {
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(buffer.subarray(0, 2048).toString("latin1"))?.[1];
  try {
    return new TextDecoder(declared ?? "utf-8").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

/**
 * Reads one thing from the web, safely: http(s) on the default ports only, to public addresses only (checked for the
 * address actually connected to, so a name that resolves into the home network is refused too, on every redirect), no
 * credentials, bounded in size, time and redirects, and only the kind of answer asked for.
 */
async function fetchBody(address: string, options: Options, kind: Kind): Promise<Body> {
  const allowed = options.allowed ?? isPublicAddress;
  const deadline = Date.now() + options.timeoutMs;

  const lookup: typeof dns.lookup = ((
    hostname: string,
    opts: dns.LookupOptions,
    callback: (...args: unknown[]) => void,
  ) => {
    dns.lookup(hostname, opts, (err, found, family) => {
      if (err) return callback(err, found, family);
      const list = Array.isArray(found) ? found.map((f) => f.address) : [found as string];
      if (list.length === 0 || list.some((a) => !allowed(a))) return callback(new Error("address_not_public"));
      callback(null, found, family);
    });
  }) as typeof dns.lookup;

  const get = (url: URL, redirects: number): Promise<Body> =>
    new Promise((resolve) => {
      const done = (page: Body) => resolve(page);
      if (url.protocol !== "http:" && url.protocol !== "https:") return done({ ok: false, reason: "invalid_address" });
      if (url.username || url.password) return done({ ok: false, reason: "invalid_address" });
      const defaultPort = url.protocol === "https:" ? "443" : "80";
      const portAllowed = options.allowedPort ?? ((port, standard) => port === "" || port === standard);
      if (!portAllowed(url.port, defaultPort)) return done({ ok: false, reason: "invalid_address" });
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (isIP(host) !== 0 && !allowed(host)) return done({ ok: false, reason: "address_not_public" });

      const remaining = deadline - Date.now();
      if (remaining <= 0) return done({ ok: false, reason: "unreachable" });
      const client = url.protocol === "https:" ? https : http;
      const req = client.request(
        url,
        {
          method: "GET",
          lookup,
          headers: {
            "User-Agent": "weekly-planner-recipe-import/1.0",
            Accept: kind.accept,
            "Accept-Encoding": "gzip, deflate, br",
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (REDIRECTS.has(status) && res.headers.location) {
            res.resume();
            if (redirects >= options.maxRedirects) return done({ ok: false, reason: "unreachable" });
            let next: URL;
            try {
              next = new URL(res.headers.location, url);
            } catch {
              return done({ ok: false, reason: "invalid_address" });
            }
            void get(next, redirects + 1).then(done);
            return;
          }
          const contentType = String(res.headers["content-type"] ?? "");
          if (status < 200 || status >= 300) {
            res.resume();
            return done({ ok: false, reason: "unreachable" });
          }
          if (!kind.allows(contentType)) {
            res.resume();
            return done({ ok: false, reason: kind.wrong });
          }
          const encoding = String(res.headers["content-encoding"] ?? "")
            .trim()
            .toLowerCase();
          let source: Readable = res;
          if (encoding === "gzip" || encoding === "x-gzip") source = res.pipe(zlib.createGunzip());
          else if (encoding === "deflate") source = res.pipe(zlib.createInflate());
          else if (encoding === "br") source = res.pipe(zlib.createBrotliDecompress());
          else if (encoding !== "" && encoding !== "identity") {
            res.resume();
            return done({ ok: false, reason: "unreachable" });
          }
          const chunks: Buffer[] = [];
          let size = 0;
          // The limit counts decoded bytes, and destroying the request stops the decoding with it.
          source.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > options.maxBytes) {
              req.destroy();
              source.destroy();
              return done({ ok: false, reason: "too_large" });
            }
            chunks.push(chunk);
          });
          source.on("end", () => done({ ok: true, body: Buffer.concat(chunks), contentType, url: url.toString() }));
          source.on("error", () => done({ ok: false, reason: "unreachable" }));
          if (source !== res) res.on("error", () => done({ ok: false, reason: "unreachable" }));
        },
      );
      req.setTimeout(remaining, () => req.destroy(new Error("timeout")));
      const timer = setTimeout(() => req.destroy(new Error("timeout")), remaining);
      req.on("close", () => clearTimeout(timer));
      req.on("error", (e) =>
        done({ ok: false, reason: e.message === "address_not_public" ? "address_not_public" : "unreachable" }),
      );
      req.end();
    });

  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { ok: false, reason: "invalid_address" };
  }
  return get(url, 0);
}

/** Reads one web page, safely (see `fetchBody`): HTML only. */
export async function fetchPage(address: string, options: Options): Promise<Page> {
  const got = await fetchBody(address, options, PAGE);
  return got.ok ? { ok: true, html: decode(got.body, got.contentType), url: got.url } : got;
}

export type Picture =
  | { ok: true; bytes: Buffer; contentType: "image/jpeg" | "image/png" | "image/webp" }
  | { ok: false; reason: SourceFailure };

/** What a picture really is, by its first bytes; null for anything else (an SVG, HTML, a script). */
export function pictureType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(bytes.subarray(from, to)));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Reads one picture, safely (see `fetchBody`): JPEG, PNG or WebP, judged by its bytes. */
export async function fetchPicture(address: string, options: Options): Promise<Picture> {
  const got = await fetchBody(address, options, PICTURE);
  if (!got.ok) return got;
  const contentType = pictureType(got.body);
  return contentType ? { ok: true, bytes: got.body, contentType } : { ok: false, reason: "not_a_page" };
}
