import { describe, expect, it } from "vitest";
import { MemoryImageShelf } from "../../../src/infrastructure/import/image-shelf.js";

const image = (n: number) => ({ bytes: Uint8Array.from([n]), contentType: "image/png" as const });

describe("MemoryImageShelf", () => {
  it("hands a picture back under an unguessable token, as often as asked", () => {
    const shelf = new MemoryImageShelf();
    const token = shelf.keep(image(1));
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(shelf.keep(image(1))).not.toBe(token);
    expect(shelf.get(token)).toEqual(image(1));
    expect(shelf.get(token)).toEqual(image(1));
    expect(shelf.get("0".repeat(32))).toBeNull();
  });

  it("lets a picture go after its time", () => {
    let now = 0;
    const shelf = new MemoryImageShelf(() => now, 1000);
    const token = shelf.keep(image(1));
    now = 999;
    expect(shelf.get(token)).not.toBeNull();
    now = 1000;
    expect(shelf.get(token)).toBeNull();
  });

  it("holds only so many, the oldest going first", () => {
    const shelf = new MemoryImageShelf(Date.now, 60_000, 2);
    const [a, b, c] = [shelf.keep(image(1)), shelf.keep(image(2)), shelf.keep(image(3))];
    expect(shelf.get(a ?? "")).toBeNull();
    expect(shelf.get(b ?? "")).not.toBeNull();
    expect(shelf.get(c ?? "")).not.toBeNull();
  });
});
