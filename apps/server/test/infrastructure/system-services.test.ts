import { describe, expect, it } from "vitest";
import { SystemRandomness } from "../../src/infrastructure/system/system-services.js";

describe("SystemRandomness", () => {
  const r = new SystemRandomness();

  it("gives the same value for the same key and different values for different keys, all in [0, 1)", () => {
    expect(r.random("s1:7")).toBe(r.random("s1:7"));
    const values = Array.from({ length: 200 }, (_, i) => r.random(`s1:${i}`));
    expect(new Set(values).size).toBeGreaterThan(190);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("is spread evenly enough to break ties fairly", () => {
    const values = Array.from({ length: 2000 }, (_, i) => r.random(`session:${i}`));
    const low = values.filter((v) => v < 0.5).length;
    expect(low).toBeGreaterThan(900);
    expect(low).toBeLessThan(1100);
  });

  it("is fresh each time without a key", () => {
    expect(new Set(Array.from({ length: 20 }, () => r.random())).size).toBeGreaterThan(15);
  });
});
