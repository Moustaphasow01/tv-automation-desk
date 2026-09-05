// Research/audit arithmetic only. Never a trading or BFF authority.
export function summarizeGrainsAuditLedger({source,comparisons,scope}) {
  const trades=source.trades.filter(row=>withinWindow(row.closed_at,scope));
  const values=trades.map(row=>finiteNumber(row.result_r));
  const known=values.filter(value=>value!==null);
  const wins=known.filter(value=>value>0),losses=known.filter(value=>value<0);
  const knownSubtotalR=known.reduce((sum,value)=>sum+value,0);
  const missingR=values.length-known.length;
  const byDay={};
  const day=at=>byDay[at.slice(0,10)]||={signals:0,intents:0,closed:0,knownSubtotalR:0,missingR:0,r:0};
  for(const row of source.signals.filter(row=>withinWindow(row.generated_at_utc,scope)))day(row.generated_at_utc).signals++;
  for(const row of source.intents.filter(row=>withinWindow(row.created_at_utc,scope)))day(row.created_at_utc).intents++;
  for(const trade of trades) {
    const item=day(trade.closed_at),value=finiteNumber(trade.result_r);
    item.closed++;
    if(value===null)item.missingR++;
    else item.knownSubtotalR+=value;
    item.r=item.missingR?null:item.knownSubtotalR;
  }
  return {signals:source.signals.filter(row=>withinWindow(row.generated_at_utc,scope)).length,
    intents:source.intents.filter(row=>withinWindow(row.created_at_utc,scope)).length,closed:trades.length,
    realizedR:missingR?null:knownSubtotalR,knownSubtotalR,missingR,
    wins:wins.length,losses:losses.length,flat:known.filter(value=>value===0).length,
    winRate:values.length&&!missingR?wins.length/values.length:null,
    profitFactor:losses.length&&!missingR?wins.reduce((a,b)=>a+b,0)/-losses.reduce((a,b)=>a+b,0):null,
    terminalTrackingMissing:comparisons.filter(row=>withinWindow(row.createdAt,scope) && row.liveEvents.length===0
      && Date.parse(row.signalExpiresAt||row.gateExpiresAt)<=Date.parse(scope.endDate)+86400000).length,byDay};
}

function withinWindow(timestamp,scope) {
  const at=Date.parse(timestamp);
  return at>=Date.parse(scope.startDate) && at<Date.parse(scope.endDate)+86400000;
}

function finiteNumber(value) {
  if(!['number','string'].includes(typeof value))return null;
  if(value===null || value===undefined || String(value).trim()==='')return null;
  return Number.isFinite(Number(value))?Number(value):null;
}
