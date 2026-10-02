// MapLibre GL 6 loads its web worker from "./maplibre-gl-worker.mjs" next to the
// main module. Bundlers rename/split that module, so the relative URL breaks
// ("Worker failed to load"). We serve the worker (and the shared chunk it imports)
// as static files instead and point MapLibre at them with setWorkerUrl().
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "maplibre");
mkdirSync(out, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(join(dist, f), join(out, f));
console.log(`maplibre worker → public/maplibre`);
