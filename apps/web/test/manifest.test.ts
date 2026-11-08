import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("the web app manifest", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../public/manifest.webmanifest"), "utf8"));

  it("accepts links shared from the phone's share sheet, read by the app on start", () => {
    expect(manifest.share_target).toEqual({
      action: "./",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    });
  });
});
