// Bundles the server and the workspace packages (TypeScript sources) into dist/server.js.
// Third-party dependencies stay external and are installed in the image.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@weekly-planner/"));

await build({
  entryPoints: ["src/main/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external,
});
console.log("built dist/server.js");
