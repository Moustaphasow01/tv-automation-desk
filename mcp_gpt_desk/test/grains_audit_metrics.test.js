import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeGrainsAuditLedger } from '../scripts/lib/grains-audit-metrics.mjs';

const scope={startDate:'2026-08-31',endDate:'2026-09-04'};
const at='2026-09-04T16:00:00.000Z';
const empty=()=>({signals:[],intents:[],trades:[],events:[]});

test('audit arithmetic reproduces the six observed theoretical R without dollar conversion',()=>{
  const source=empty();
  source.trades=[-1,-1,1.57142857,1.6,-1,-1].map(result_r=>({closed_at:at,result_r:String(result_r)}));
  const result=summarizeGrainsAuditLedger({source,comparisons:[],scope});
  assert.ok(Math.abs(result.realizedR-(-0.82857143))<1e-9);
  assert.equal(result.closed,6);
  assert.equal(result.wins,2);
  assert.equal(result.losses,4);
  assert.equal(result.winRate,1/3);
  assert.equal(result.missingR,0);
});

test('unknown R is never transformed into a flat trade or complete total',()=>{
  for(const unknown of [null,undefined,'','  ','not-a-number',Infinity,false,true,[],{}]) {
    const source=empty();
    source.trades=[{closed_at:at,result_r:'1.5'},{closed_at:at,result_r:unknown}];
    const result=summarizeGrainsAuditLedger({source,comparisons:[],scope});
    assert.equal(result.realizedR,null);
    assert.equal(result.knownSubtotalR,1.5);
    assert.equal(result.flat,0);
    assert.equal(result.missingR,1);
    assert.equal(result.winRate,null);
    assert.equal(result.profitFactor,null);
    assert.equal(result.byDay['2026-09-04'].r,null);
  }
});

test('the close-date cohort includes carry-in positions and excludes next-week closes',()=>{
  const source=empty();
  source.trades=[
    {opened_at:'2026-08-28',closed_at:'2026-08-31T00:00:00.000Z',result_r:1},
    {closed_at:'2026-09-04T23:59:59.999Z',result_r:-1},
    {closed_at:'2026-09-05T00:00:00.000Z',result_r:100},
    {closed_at:null,result_r:100},
  ];
  const result=summarizeGrainsAuditLedger({source,comparisons:[],scope});
  assert.equal(result.realizedR,0);
  assert.equal(result.closed,2);
});

test('a supplied empty ledger is empty, not a 100 percent win rate',()=>{
  const result=summarizeGrainsAuditLedger({source:empty(),comparisons:[],scope});
  assert.equal(result.realizedR,0);
  assert.equal(result.closed,0);
  assert.equal(result.winRate,null);
  assert.equal(result.profitFactor,null);
});

test('only expired dossiers lacking all tracking events are flagged in this diagnostic',()=>{
  const row={createdAt:at,signalExpiresAt:'2026-09-04T17:00:00.000Z',liveEvents:[]};
  const comparisons=[row,{...row,liveEvents:['entry_expired']},
    {...row,signalExpiresAt:'2026-09-07T17:00:00.000Z'},
    {...row,createdAt:'2026-08-28T16:00:00.000Z'}];
  const result=summarizeGrainsAuditLedger({source:empty(),comparisons,scope});
  assert.equal(result.terminalTrackingMissing,1);
});

test('signal and intent counts respect the same explicit period',()=>{
  const source=empty();
  source.signals=[{generated_at_utc:at},{generated_at_utc:'2026-08-30T23:59:59Z'}];
  source.intents=[{created_at_utc:at},{created_at_utc:'2026-09-05T00:00:00Z'}];
  const result=summarizeGrainsAuditLedger({source,comparisons:[],scope});
  assert.equal(result.signals,1);
  assert.equal(result.intents,1);
  assert.deepEqual(Object.keys(result.byDay),['2026-09-04']);
});
