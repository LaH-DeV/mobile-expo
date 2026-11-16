import type { Clock, DistanceMeters, Hasher, RandomSource } from "./adapters";
import type { Config } from "./config";
import type { DatabaseHandle } from "./db/client";
import type { ContentStore } from "../modules/content/store";

/**
 * Explicit composition of the adapters used by application use cases. Built once in
 * `composition.ts`; tests build their own with a fake clock and an isolated database.
 */
export interface AppContext {
  config: Config;
  database: DatabaseHandle;
  clock: Clock;
  random: RandomSource;
  hasher: Hasher;
  distance: DistanceMeters;
  content: ContentStore;
}
