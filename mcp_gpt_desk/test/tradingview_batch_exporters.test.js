import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "../..");

const exporters = [
  {
    file: "market_feed_batch_m1_exporter.pine",
    securityCalls: 2,
    symbols: ["CME_MINI:MNQ1!", "CME_MINI:MES1!"],
  },
  {
    file: "market_feed_batch_m5_exporter.pine",
    securityCalls: 18,
    symbols: [
      "CME_MINI:MNQ1!",
      "CME_MINI:MES1!",
      "TVC:US10Y",
      "TVC:US02Y",
      "TVC:DXY",
      "NYMEX:CL1!",
      "COMEX:GC1!",
      "CBOE:VIX",
      "TVC:NI225",
      "TVC:HSI",
      "XETR:DAX",
      "TVC:SX5E",
      "NASDAQ:NVDA",
      "NASDAQ:AAPL",
      "NASDAQ:MSFT",
      "NASDAQ:TSLA",
      "NASDAQ:SMH",
      "NASDAQ:SOXX",
    ],
  },
  {
    file: "market_feed_batch_m15_exporter.pine",
    securityCalls: 2,
    symbols: ["CME_MINI:NQ1!", "CME_MINI:ES1!"],
  },
  {
    file: "market_feed_batch_h1_exporter.pine",
    securityCalls: 2,
    symbols: ["CME_MINI:NQ1!", "CME_MINI:ES1!"],
  },
  {
    file: "market_feed_batch_h4_exporter.pine",
    securityCalls: 20,
    symbols: [
      "CME_MINI:MNQ1!",
      "CME_MINI:MES1!",
      "CME_MINI:NQ1!",
      "CME_MINI:ES1!",
      "TVC:US10Y",
      "TVC:US02Y",
      "TVC:DXY",
      "NYMEX:CL1!",
      "COMEX:GC1!",
      "CBOE:VIX",
      "TVC:NI225",
      "TVC:HSI",
      "XETR:DAX",
      "TVC:SX5E",
      "NASDAQ:NVDA",
      "NASDAQ:AAPL",
      "NASDAQ:MSFT",
      "NASDAQ:TSLA",
      "NASDAQ:SMH",
      "NASDAQ:SOXX",
    ],
  },
];

test("TradingView batch exporters stay within request tuple limits and cover canonical feeds", async () => {
  for (const exporter of exporters) {
    const source = await readFile(
      path.join(projectRoot, "tradingview", exporter.file),
      "utf8",
    );

    assert.match(source, /type FeedPoint/);
    assert.match(source, /f_feed_point\(\)/);
    assert.match(source, /ATR_10_LEN = 10/);
    assert.match(source, /ATR_14_LEN = 14/);
    assert.match(source, /"atr_10":' \+ f_num\(a10\)/);
    assert.match(source, /"atr_14":' \+ f_num\(a14\)/);
    assert.match(source, /alert\(payload, alert\.freq_once_per_bar_close\)/);
    assert.doesNotMatch(source, /\[s\d+t,\s*s\d+o/);

    const securityCalls = source.match(/request\.security\(/g) || [];
    assert.equal(securityCalls.length, exporter.securityCalls, exporter.file);

    for (const symbol of exporter.symbols) {
      assert.ok(source.includes(`"${symbol}"`), `${exporter.file} misses ${symbol}`);
    }
  }
});
