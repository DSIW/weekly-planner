import type { RouteContext } from "./context.js";

export function registerEventRoutes(ctx: RouteContext): void {
  const { app, api, options, requireMember } = ctx;
  // Server-Sent Events: a signal that something changed; the client refetches what it shows.
  const streams = new Set<{ end(): void }>();
  app.addHook("onClose", async () => {
    for (const stream of streams) stream.end();
  });
  app.get(`${api}/events`, (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\nevent: ready\ndata: {}\n\n");
    const unsubscribe = options.subscribe((event) =>
      res.write(`event: changed\ndata: ${JSON.stringify({ type: event.type })}\n\n`),
    );
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    streams.add(res);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(res);
    });
    return reply;
  });
}
