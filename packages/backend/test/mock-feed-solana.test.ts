/**
 * Wave 9 — the mock X feed emits Solana submissions.
 *
 * Mock mode must exercise BOTH chains end-to-end ($0, seeded) so the funnel,
 * Faculty Room, and trade record show Base and Solana side by side. Each poll
 * batch includes at least one pump.fun (base58 "pump" mint) thesis that
 * guessChain resolves to solana.
 *
 * RED until the mock feed produces Solana CAs.
 */

import "./helpers/isolate-store.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockX } from "../src/adapters/x/mock.js";
import { extractContract, guessChain } from "../src/util/contracts.js";

test("MockX: each poll batch contains a Solana (pump.fun) thesis", async () => {
  const x = new MockX();
  const batch = await x.pollMentions();
  const chains = batch
    .map((p) => extractContract(p.text))
    .filter((c): c is string => c !== null)
    .map((c) => guessChain(c));
  assert.ok(chains.includes("solana"), `expected a solana CA in the batch; got ${chains.join(",")}`);
  assert.ok(chains.includes("base"), "expected base CAs too (mixed-chain feed)");
});

test("MockX: the Solana mint carries the pump.fun vanity suffix", async () => {
  const x = new MockX();
  const batch = await x.pollMentions();
  const solCa = batch
    .map((p) => extractContract(p.text))
    .filter((c): c is string => c !== null)
    .find((c) => guessChain(c) === "solana");
  assert.ok(solCa, "expected a solana CA");
  assert.ok(solCa.toLowerCase().endsWith("pump"), `pump.fun mint should end in 'pump': ${solCa}`);
});
