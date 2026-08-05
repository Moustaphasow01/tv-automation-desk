import assert from "node:assert/strict";
import test from "node:test";
import { FixedWindowRateLimiter } from "../src/request-rate-limiter.js";

test("fixed-window limiter blocks above the limit and resets", () => {
  let now = 1_000;
  const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 10_000, clock: () => now });
  assert.equal(limiter.consume("ip").allowed, true);
  assert.equal(limiter.consume("ip").allowed, true);
  assert.equal(limiter.consume("ip").allowed, false);
  now = 11_001;
  assert.equal(limiter.consume("ip").allowed, true);
});
