/**
 * Regression guard (S3): a cap <= 0 (e.g. OBS_RECENT_BUFFER_SIZE=0) must NOT turn
 * the ring buffer into a black hole. The constructor clamps cap to >= 1, so a
 * recorded entry stays retrievable instead of being silently dropped by slice(-0).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MemoryEventLog } from "../src/observability/eventLog.js";

describe("MemoryEventLog — cap guard", () => {
  it("cap=0 is clamped to >=1 so entries are not silently dropped", () => {
    const buf = new MemoryEventLog(0);
    buf.record({ at: "t", level: "info", area: "test", type: "x", msg: "m" });
    const recent = buf.recent(5);
    assert.equal(recent.length, 1, "cap=0 should clamp to 1, not drop everything");
    assert.equal(recent[0]?.msg, "m");
  });
});
