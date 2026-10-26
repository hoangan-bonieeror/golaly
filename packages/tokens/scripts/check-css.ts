/**
 * Fails when the web's Tailwind theme (apps/web/src/app/globals.css) and @golaly/tokens disagree on a colour,
 * so the app and the web can't drift apart. Run in CI: `npm run check -w @golaly/tokens`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cssVar, dark, light, type ColorName } from "../src/index.ts";

const css = readFileSync(fileURLToPath(new URL("../../../apps/web/src/app/globals.css", import.meta.url)), "utf8");

function block(start: string): string {
  const i = css.indexOf(start);
  if (i < 0) throw new Error(`globals.css: "${start}" not found`);
  return css.slice(i, css.indexOf("\n}", i));
}
function colors(src: string): Map<string, string> {
  return new Map([...src.matchAll(/(--color-[\w-]+):\s*(#[0-9a-fA-F]+);/g)].map((m) => [m[1], m[2].toLowerCase()]));
}

const cssLight = colors(block("@theme {"));
const cssDark = colors(block('html[data-theme="dark"] {'));
const problems: string[] = [];
const names = Object.keys(light) as ColorName[];
const known = new Set(names.map(cssVar));

for (const name of names) {
  const v = cssVar(name);
  if (cssLight.get(v) !== light[name].toLowerCase()) problems.push(`${v}: globals.css ${cssLight.get(v) ?? "(missing)"} ≠ tokens.light.${name} ${light[name]}`);
  const night = cssDark.get(v) ?? cssLight.get(v);
  if (night !== dark[name].toLowerCase()) problems.push(`${v} (dark): globals.css ${night ?? "(missing)"} ≠ tokens.dark.${name} ${dark[name]}`);
}
for (const v of [...cssLight.keys(), ...cssDark.keys()]) if (!known.has(v)) problems.push(`${v} is in globals.css but not in @golaly/tokens`);

if (problems.length) {
  console.error(`Design tokens out of sync:\n  ${[...new Set(problems)].join("\n  ")}`);
  process.exit(1);
}
console.log(`Design tokens in sync (${names.length} colours, light + dark).`);
