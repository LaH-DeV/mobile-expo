import { buildApp, checkReadiness } from "./app";
import { createAppContext } from "./composition";
import { ConfigError, loadDotEnv, parseConfig } from "./infrastructure/config";

async function main(): Promise<void> {
  loadDotEnv();
  const config = parseConfig(process.env);
  const ctx = createAppContext(config);
  const app = await buildApp(ctx);

  if (config.allowInsecureHttp) {
    app.log.warn(
      "ALLOW_INSECURE_HTTP=true: serving plain HTTP for local development only. Never expose this publicly.",
    );
  }
  const readiness = checkReadiness(ctx);
  if (readiness.status !== "ready") {
    // Keep serving /health and /ready so the cause is observable, but say so loudly.
    app.log.error({ checks: readiness.checks }, "not ready: run `npm run db:migrate` and `npm run content:load`");
  }

  const shutdown = async () => {
    await app.close();
    ctx.database.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  // Configuration messages name variables only; anything else is reported by class to avoid leaking values.
  console.error(error instanceof ConfigError ? error.message : `Server failed to start (${(error as Error).name}).`);
  if (!(error instanceof ConfigError)) console.error((error as Error).message);
  process.exitCode = 1;
});
