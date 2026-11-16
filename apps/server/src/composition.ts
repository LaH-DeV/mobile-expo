import { createHasher, cryptoRandom, systemClock, wgs84Distance } from "./infrastructure/adapters";
import type { Config } from "./infrastructure/config";
import type { AppContext } from "./infrastructure/context";
import { openDatabase } from "./infrastructure/db/client";
import { ContentStore } from "./modules/content/store";

/**
 * Production composition: system clock, cryptographic randomness, real geodesy, persistent
 * SQLite. There is no switch that swaps in fake GPS, QR or clock behaviour; test doubles are
 * constructed only by the test suite, which is not part of this module graph.
 */
export function createAppContext(config: Config): AppContext {
  return {
    config,
    database: openDatabase(config.databasePath),
    clock: systemClock,
    random: cryptoRandom,
    hasher: createHasher(config.fingerprintSecret),
    distance: wgs84Distance,
    content: new ContentStore(),
  };
}
