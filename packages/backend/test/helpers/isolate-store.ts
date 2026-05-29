/**
 * Test isolation preload. Import this FIRST (before any src import) so the
 * file-backed store writes to a throwaway temp dir instead of the real
 * ./data/thesis-data.json that the running dev server uses. Also pins mock
 * mode so adapters are deterministic and never touch the network.
 *
 *   import "./helpers/isolate-store.js";   // must be the first import
 *   import { ... } from "../src/...";
 *
 * Works because config.ts reads these env vars at module-evaluation time, and
 * ES modules evaluate imports in source order — this side-effecting module
 * runs before config.ts is evaluated.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.THESIS_MODE = "mock";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "thesis-test-"));
