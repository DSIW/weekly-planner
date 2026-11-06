import { randomBytes } from "node:crypto";
import type { DraftImage, ImageShelf } from "@weekly-planner/application";

/** Adapter: pictures held in memory for a while. A restart or the time running out only costs the picture. */
export class MemoryImageShelf implements ImageShelf {
  private readonly held = new Map<string, { image: DraftImage; at: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly keepMs = 30 * 60_000,
    private readonly capacity = 20,
  ) {}

  keep(image: DraftImage): string {
    this.expire();
    while (this.held.size >= this.capacity) {
      const oldest = this.held.keys().next().value;
      if (oldest === undefined) break;
      this.held.delete(oldest);
    }
    const token = randomBytes(16).toString("hex");
    this.held.set(token, { image, at: this.now() });
    return token;
  }

  get(token: string): DraftImage | null {
    this.expire();
    return this.held.get(token)?.image ?? null;
  }

  private expire(): void {
    for (const [token, { at }] of this.held) if (this.now() - at >= this.keepMs) this.held.delete(token);
  }
}
