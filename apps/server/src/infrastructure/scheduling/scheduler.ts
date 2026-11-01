interface Job {
  readonly name: string;
  readonly everyMs: number;
  run(): Promise<unknown>;
}

/**
 * Runs each job once right away (a server that was down at 08:00 still reminds when it comes back), then every
 * `everyMs`. A job never overlaps itself, and a failing job is reported and tried again at the next tick.
 * Returns the way to stop.
 */
export function startScheduler(jobs: readonly Job[], log: (line: string) => void = console.error): () => void {
  const timers = jobs.map((job) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await job.run();
      } catch (error) {
        log(`job ${job.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        running = false;
      }
    };
    void tick();
    return setInterval(() => void tick(), job.everyMs);
  });
  return () => {
    for (const t of timers) clearInterval(t);
  };
}
