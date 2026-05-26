/**
 * THESIS backend — entry point.
 *
 *   npm start       run the full service: HTTP server + poll/monitor loops
 *   npm run demo    run one scripted pipeline cycle, print it, exit
 *
 * In mock mode (the default) everything runs locally with no API keys and no
 * cost. Switch to live mode by filling in .env and setting THESIS_MODE=live.
 */

import { config } from "./config.js";
import { startServer } from "./server/index.js";
import { runOnce, startService } from "./service.js";
import { log } from "./util/log.js";

async function main(): Promise<void> {
  log.info(`THESIS backend starting — mode: ${config.mode}`);

  if (process.argv.includes("--demo")) {
    await runOnce();
    log.info("demo cycle complete.");
    return;
  }

  startServer();
  startService();
  log.info("service running — press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
