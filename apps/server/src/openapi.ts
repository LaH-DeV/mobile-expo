import { ERRORS, ErrorEnvelopeSchema, HEADERS, ROUTES, type RouteContract } from "@signal-hunt/contracts";
import { z } from "zod";

type JsonSchema = Record<string, unknown>;

function toSchema(schema: z.ZodType, io: "input" | "output"): JsonSchema {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as JsonSchema;
  return rest;
}

function parameters(contract: RouteContract): JsonSchema[] {
  const result: JsonSchema[] = [];
  const fromObject = (schema: z.ZodType | undefined, location: "path" | "query") => {
    if (!schema) return;
    const json = toSchema(schema, "input") as { properties?: Record<string, JsonSchema>; required?: string[] };
    for (const [name, property] of Object.entries(json.properties ?? {})) {
      result.push({
        name,
        in: location,
        required: location === "path" || (json.required ?? []).includes(name),
        schema: property,
      });
    }
  };
  fromObject(contract.params, "path");
  fromObject(contract.query, "query");
  const header = (name: string, description: string, schema: JsonSchema = { type: "string" }) =>
    result.push({ name, in: "header", required: true, description, schema });
  if (contract.localized) header("Accept-Language", "Content locale", { type: "string", enum: ["pl", "en"] });
  if (contract.operation) header("Idempotency-Key", "Client-generated random key, 16-64 URL-safe characters");
  if (contract.auth === "deletion-proof") header(HEADERS.deletionReceiptProof, "Deletion receipt proof");
  for (const name of contract.headers ?? []) header(name, "Required header");
  return result;
}

/** OpenAPI 3.1 description derived from the same route table the server registers. */
export function buildOpenApiDocument(): JsonSchema {
  const errorStatuses = [...new Set(Object.values(ERRORS).map((definition) => definition.status))].sort();
  const paths: Record<string, Record<string, JsonSchema>> = {};
  for (const [operationId, contract] of Object.entries(ROUTES) as [string, RouteContract][]) {
    const path = contract.path.replace(/:([A-Za-z]+)/g, "{$1}");
    const responses: Record<string, JsonSchema> = {
      [String(contract.successStatus)]: {
        description: "Success",
        content: { "application/json": { schema: toSchema(contract.response, "output") } },
      },
    };
    for (const status of errorStatuses) {
      responses[String(status)] = {
        description: "Error envelope",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
      };
    }
    (paths[path] ??= {})[contract.method.toLowerCase()] = {
      operationId,
      summary: contract.summary,
      parameters: parameters(contract),
      ...(contract.body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: toSchema(contract.body, "input") } },
            },
          }
        : {}),
      ...(contract.auth === "bearer" ? { security: [{ installationCredential: [] }] } : {}),
      responses,
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Signal Hunt API",
      version: "1.0.0",
      description: "Generated from @signal-hunt/contracts. Error codes: " + Object.keys(ERRORS).join(", "),
    },
    paths,
    components: {
      schemas: { ErrorEnvelope: toSchema(ErrorEnvelopeSchema, "output") },
      securitySchemes: {
        installationCredential: { type: "http", scheme: "bearer", description: "Anonymous installation credential" },
      },
    },
  };
}
