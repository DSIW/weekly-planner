import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serves the built web app: files from `root`, and `index.html` for any other path without a file extension
 * (client-side routes). Registered last so the API routes win.
 */
export function serveWebApp(app: FastifyInstance, root: string, basePath: string): void {
  const dir = resolve(root);
  app.get(`${basePath}/*`, async (req, reply) => {
    const requested = decodeURIComponent((req.params as { "*": string })["*"]);
    const candidate = resolve(join(dir, normalize(requested)));
    const inside = candidate === dir || candidate.startsWith(dir + sep);
    const isFile = inside && existsSync(candidate) && statSync(candidate).isFile();
    if (!isFile && extname(requested) !== "") return reply.code(404).send({ error: "not_found" });
    const file = isFile ? candidate : join(dir, "index.html");
    if (!existsSync(file)) return reply.code(404).send({ error: "web_app_not_built" });
    const hashed = requested.startsWith("assets/");
    return reply
      .type(TYPES[extname(file)] ?? "application/octet-stream")
      .header("Cache-Control", hashed ? "public, max-age=31536000, immutable" : "no-cache")
      .send(createReadStream(file));
  });
  // `/plan` without a trailing slash opens the app too.
  if (basePath !== "") app.get(basePath, async (_req, reply) => reply.redirect(`${basePath}/`));
}
