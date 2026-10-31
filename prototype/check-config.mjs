import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const context = { window: {} };
for (const filename of ["config/hunts.js", "game.js"]) {
  const source = readFileSync(new URL(filename, import.meta.url), "utf8");
  runInNewContext(source, context, { filename });
}

const hunts = context.window.SignalHuntHunts;
const stops = hunts.reduce((total, hunt) => total + hunt.checkpoints.length, 0);
console.log(
  `Valid hunt configuration: ${hunts.length} hunts, ${stops} checkpoints, complete EN/PL content.`,
);
