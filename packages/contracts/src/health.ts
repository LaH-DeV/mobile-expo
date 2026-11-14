import { z } from "zod";

export const HealthResponseSchema = z.object({ status: z.literal("ok") });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ReadyResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.object({ database: z.boolean(), schema: z.boolean(), content: z.boolean() }),
});
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
