#!/usr/bin/env node
// Read-only experiment: replay frozen candles, never create a store or publish a signal.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { replayUsGrainsStrategySuiteV1, buildGrainMarketContext, adjudicateGrainSignal, US_GRAINS_STRATEGY_SUITE_VERSION } from '../src/us-grains-strategy-suite.js';
import { simulateLimitSignalOutcome } from '../src/us-grains-strategy-engine.js';
import { grainChicagoDate, isGrainsRth } from '../src/us-grains-data-quality.js';
import { summarizeGrainsAuditLedger } from './lib/grains-audit-metrics.mjs';

if (US_GRAINS_STRATEGY_SUITE_VERSION !== 'us_grains_strategy_suite_v1') {
  throw new Error('LEGACY_GRAINS_AUDIT_VERSION_MISMATCH: reproduce the legacy audit from its pinned commit; use audit:grains:causal or grains:replay-context-theoretical for the causal suite.');
}

const [inputFile, outputFile, startDate, endDate] = process.argv.slice(2);
if (!inputFile || !outputFile) throw new Error('Usage: node audit_us_grains_week.mjs <frozen-evidence.json> <report.json> <YYYY-MM-DD> <YYYY-MM-DD>');
if (resolve(inputFile) === resolve(outputFile)) throw new Error('Frozen evidence must not be overwritten.');
for (const day of [startDate, endDate]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !Number.isFinite(Date.parse(day))
    || new Date(day).toISOString().slice(0,10) !== day) throw new Error('Two valid dates are required.');
}
if (startDate > endDate) throw new Error('Inverted date window.');
const text = await readFile(resolve(inputFile), 'utf8');
const source = JSON.parse(text);
if (!Array.isArray(source.candles) || !Array.isArray(source.agriEvents)) throw new Error('Frozen candles and agriEvents arrays are required.');
const hasLedger = ['signals','intents','trades','events'].every(key => Array.isArray(source[key]));
for (const key of ['signals','intents','trades','events']) source[key] ||= [];
const dates = {startDate,endDate};
source.signals = source.signals.filter(row => withinWindow(row.generated_at_utc,dates));
source.intents = source.intents.filter(row => withinWindow(row.created_at_utc,dates));
const bySymbol = {};
for (const candle of source.candles) {
  const [, , symbol, timeframe] = candle.feed_id.split('__');
  (bySymbol[`${symbol}:${timeframe}`] ||= []).push(candle);
}
console.error('Running frozen-data reference using the deployed suite.');
const reference = replayUsGrainsStrategySuiteV1({rowsBySymbol: bySymbol, agriEvents: source.agriEvents, instruments:['ZW','ZC'], ...dates});
const liveById = new Map(source.signals.map(signal => [signal.signal_id, signal]));
const dayRows = groupContextDays(bySymbol);
const decisionById = new Map(reference.context_decisions.map(row => [row.signal_id,row]));
const prefixContexts = reference.raw_signals.map(signal => {
  const cutoff = signal.generated_at_utc;
  const day = grainChicagoDate(cutoff);
  const own = (dayRows.get(`${signal.instrument}1!:${day}`)||[]).filter(row=>row.timestamp_utc<=cutoff);
  const peer = (dayRows.get(`${signal.instrument === 'ZW' ? 'ZC' : 'ZW'}1!:${day}`)||[]).filter(row=>row.timestamp_utc<=cutoff);
  // Same legacy bar-label convention on both sides isolates full-day context leakage.
  const context = buildGrainMarketContext({instrument:signal.instrument, rows:own, peerRows:peer, tradingDate:day, events:source.agriEvents});
  const pointInTime = adjudicateGrainSignal({signal,frame:{context}});
  const batch = decisionById.get(signal.signal_id);
  return {signalId:signal.signal_id,instrument:signal.instrument,at:cutoff,direction:signal.direction,
    batchBias:signal.setup.context.instrument_bias,prefixBias:context.instrument_bias,
    batchDecision:batch?.recommendation,prefixDecision:pointInTime.recommendation,
    decisionChanged:batch?.recommendation !== pointInTime.recommendation,
    acceptedChanged:batch?.accepted !== pointInTime.accepted};
});
const intentComparisons = source.intents.map(intent => {
  const signal = (intent.lineage?.strategy_signal_ids || []).map(id => liveById.get(id)).find(Boolean);
  const trade = source.trades.find(item => item.portfolio_order_intent_id === intent.portfolio_order_intent_id);
  const events = source.events.filter(item => item.portfolio_order_intent_id === intent.portfolio_order_intent_id);
  const replayOutcome = signal ? simulateLimitSignalOutcome({signal,executionRows:bySymbol[`${intent.instrument}1!:1`]}) : null;
  return {intentId:intent.portfolio_order_intent_id,signalId:signal?.signal_id,instrument:intent.instrument,
    generatedAt:signal?.generated_at_utc,createdAt:intent.created_at_utc,
    signalExpiresAt:signal?.expires_at_utc,gateExpiresAt:intent.gate_expiry,
    gateState:intent.gate_status,liveR:trade?.result_r == null ? null:Number(trade.result_r),
    liveFilledAt:trade?.opened_at,liveClosedAt:trade?.closed_at,liveEvents:events.map(e=>e.event_type),
    replayOutcome,publicationLagMinutes:signal ? (Date.parse(signal.created_at_utc)-Date.parse(signal.generated_at_utc))/60000:null};
});
const report = {
  schemaVersion:'grains_week_integrity_audit_v2',generatedAt:new Date().toISOString(),
  sourceAsOf:source.asOf,sourceSha256:createHash('sha256').update(text).digest('hex'),
  suiteSha256:createHash('sha256').update(await readFile(new URL('../src/us-grains-strategy-suite.js',import.meta.url))).digest('hex'),
  simulatorSha256:createHash('sha256').update(await readFile(new URL('../src/us-grains-strategy-engine.js',import.meta.url))).digest('hex'),
  scope:dates,authority:'OFFLINE_DIAGNOSTIC_NOT_BROKER_RESULT',
  ledgerAvailability:hasLedger?'PROVIDED_SNAPSHOT_NOT_EXTERNAL_COMPLETENESS_CERTIFICATION':'NOT_PROVIDED',
  live:hasLedger?summarizeGrainsAuditLedger({source,comparisons:intentComparisons,scope:dates}):null,
  batchSuite:compact(reference),
  fullDayContextLeakage:{checked:prefixContexts.length,
    changedDecisions:prefixContexts.filter(x=>x.decisionChanged).length,
    changedAdmission:prefixContexts.filter(x=>x.acceptedChanged).length, rows:prefixContexts},
  fillsBeforeM5Close:{count:reference.trades.filter(row=>row.filled_at_utc && Date.parse(row.filled_at_utc)<Date.parse(row.generated_at_utc)+300000).length,filledTotal:reference.filled_trade_count},
  liveOnlySignals:hasLedger?source.signals.filter(s=>!reference.raw_signals.some(r=>r.signal_id===s.signal_id)).map(s=>s.signal_id):null,
  batchOnlySignals:hasLedger?reference.accepted_signals.filter(s=>!liveById.has(s.signal_id)).map(s=>({id:s.signal_id,at:s.generated_at_utc,instrument:s.instrument})):null,
  intentComparisons:hasLedger?intentComparisons:null,
  m1m5Consistency: ['ZW','ZC'].map(instrument=>candleConsistency(instrument,bySymbol,dates)),
  workerStatus:source.workers,
  limitations:['Corrected/current candles do not reconstruct arrival history before backfill.',
    'Suite selection is upstream of canonical Portfolio / Global Risk / Human Gate.',
    'Prefix-context audit isolates context lookahead; it is not a full causal simulation.',
    'No cost model is inferred from observed R; broker results are not supplied.']
};
await mkdir(dirname(resolve(outputFile)),{recursive:true});
await writeFile(resolve(outputFile),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({live:report.live,batch:report.batchSuite,contextChanges:report.fullDayContextLeakage.changedDecisions,
  contextAdmissionChanges:report.fullDayContextLeakage.changedAdmission,m1m5:report.m1m5Consistency,
  earlyFills:report.fillsBeforeM5Close.count,liveOnly:report.liveOnlySignals?.length??null,batchOnly:report.batchOnlySignals?.length??null},null,2));

function groupContextDays(bySymbol) {
  const days=new Map();
  for(const [key,rows]of Object.entries(bySymbol)) {
    if(!key.endsWith(':5'))continue;
    for(const row of rows) {
      if(!isGrainsRth(row.timestamp_utc))continue;
      const dayKey=`${key.split(':')[0]}:${grainChicagoDate(row.timestamp_utc)}`;
      if(!days.has(dayKey))days.set(dayKey,[]);
      days.get(dayKey).push(row);
    }
  }
  return days;
}

function compact(replay) {
  return Object.fromEntries(Object.entries(replay).filter(([key,value])=>typeof value!=='object' || ['by_day','by_family'].includes(key)));
}

function withinWindow(at,scope) {
  return Date.parse(at)>=Date.parse(scope.startDate) && Date.parse(at)<Date.parse(scope.endDate)+86400000;
}

function candleConsistency(instrument,bySymbol,window) {
  const m1=new Map((bySymbol[`${instrument}1!:1`]||[]).map(row=>[Date.parse(row.timestamp_utc),row]));
  const result={instrument,completeWindows:0,mismatched:0,incompleteWindows:0,examples:[]};
  for(const candle of bySymbol[`${instrument}1!:5`]||[]) {
    if(candle.timestamp_utc<window.startDate||candle.timestamp_utc.slice(0,10)>window.endDate||!isGrainsRth(candle.timestamp_utc))continue;
    const start=Date.parse(candle.timestamp_utc);
    const bars=Array.from({length:5},(_,i)=>m1.get(start+i*60000));
    if(bars.some(bar=>!bar)){result.incompleteWindows++;continue;}
    result.completeWindows++;
    const rebuilt={open:Number(bars[0].open),high:Math.max(...bars.map(b=>Number(b.high))),low:Math.min(...bars.map(b=>Number(b.low))),close:Number(bars[4].close)};
    if(Object.keys(rebuilt).some(key=>Math.abs(rebuilt[key]-Number(candle[key]))>0.000001)) {
      result.mismatched++;
      if(result.examples.length<5)result.examples.push({at:candle.timestamp_utc,published:{open:candle.open,high:candle.high,low:candle.low,close:candle.close},rebuilt});
    }
  }
  return result;
}
