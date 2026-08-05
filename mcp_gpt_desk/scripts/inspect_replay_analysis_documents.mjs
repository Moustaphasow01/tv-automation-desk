#!/usr/bin/env node
import process from "node:process";

import { createDeskStoreFromEnv } from "../src/store.js";

const runId = String(process.argv[2] || "").trim();
if (!runId) {
  console.error("Usage: node inspect_replay_analysis_documents.mjs <run_id>");
  process.exitCode = 2;
} else {
  const store = createDeskStoreFromEnv();
  try {
    await store.persistence.initialized;
    const result = await store.persistence.pool.query(
      `SELECT collection, document_id, data
       FROM desk_documents
       WHERE collection IN (
         'desk_replay_master_analyses',
         'desk_replay_monitors',
         'desk_replay_positions',
         'desk_replay_setups',
         'desk_replay_trade_simulations'
       )
         AND (
           data->>'backtest_id' = $1
           OR data->>'replay_run_id' = $1
           OR data->>'run_id' = $1
         )
       ORDER BY collection, COALESCE(
         data->>'cutoff_paris',
         data->>'timestamp_paris',
         data->>'created_at_utc'
       ), document_id`,
      [runId],
    );
    const byCollection = {};
    for (const row of result.rows) {
      const bucket = byCollection[row.collection] ||= {
        count: 0,
        keys: new Set(),
        documents: [],
      };
      bucket.count += 1;
      for (const key of Object.keys(row.data || {})) bucket.keys.add(key);
      bucket.documents.push(project(row.collection, row.document_id, row.data || {}));
    }
    console.log(JSON.stringify(Object.fromEntries(
      Object.entries(byCollection).map(([collection, value]) => [
        collection,
        {
          count: value.count,
          keys: [...value.keys].sort(),
          documents: value.documents,
        },
      ]),
    ), null, 2));
  } finally {
    await store.persistence.close?.();
  }
}

function project(collection, documentId, data) {
  const common = {
    document_id: documentId,
    step_id: data.step_id || null,
    cutoff_paris: data.cutoff_paris || data.timestamp_paris || data.to_timestamp || null,
    status: data.status || data.setup_status || data.lifecycle_status || null,
  };
  if (collection === "desk_replay_master_analyses") {
    return {
      ...common,
      analysis_id: data.analysis_id || null,
      executive_summary: data.executive_summary || data.summary
        || data.full_analysis?.executive_summary
        || data.full_analysis?.synthese_executive
        || null,
      market_regime: data.market_regime || data.regime || null,
      primary_bias: data.primary_bias || data.bias || null,
      confidence: data.confidence || data.confidence_score || null,
      thesis: data.thesis || data.trading_thesis || null,
      invalidations: data.invalidations || data.invalidation || null,
      executable_decision: data.executable_decision || null,
      active_thesis: data.active_thesis || null,
      final_sections: data.final_sections || null,
      full_analysis: data.full_analysis || null,
      setups: data.setups || data.trade_setups || [],
      data_quality_status: data.data_quality?.status || data.data_quality_status || null,
    };
  }
  if (collection === "desk_replay_monitors") {
    return {
      ...common,
      monitor_id: data.monitor_id || null,
      action: data.action || data.monitor_action || data.decision
        || data.monitor_decision?.action
        || data.monitor_decision
        || null,
      reason_summary: data.reason_summary || data.summary || null,
      detailed_reason: data.detailed_reason || data.analysis || null,
      thesis_status_before: data.thesis_status_before || null,
      thesis_status_after: data.thesis_status_after || null,
      monitor_decision: data.monitor_decision || null,
      active_thesis_before: data.active_thesis_before || null,
      active_thesis_update: data.active_thesis_update || null,
      invalidation_check: data.invalidation_check || null,
      time_decay_check: data.time_decay_check || null,
      scenario_transformation_check: data.scenario_transformation_check || null,
      wait_to_go_check: data.wait_to_go_check || null,
      position_check: data.position_check || null,
      setup_candidate: data.setup_candidate || null,
      setup_transition: data.setup_transition || null,
      position_action: data.position_action || data.position_update || null,
      setup_action: data.setup_action || data.setup_update || data.setup_updates || null,
      next_revalidation_time: data.next_revalidation_time || null,
      data_quality_status: data.data_quality?.status || data.data_quality_status || null,
    };
  }
  if (collection === "desk_replay_positions") {
    return {
      ...common,
      position_id: data.position_id || documentId,
      instrument: data.instrument || null,
      direction: data.direction || null,
      setup_id: data.setup_id || null,
      entry_price: data.entry_price ?? null,
      initial_stop_loss: data.initial_stop_loss ?? data.stop_loss ?? null,
      stop_loss: data.stop_loss ?? null,
      take_profit_1: data.take_profit_1 ?? null,
      opened_at_paris: data.opened_at_paris || null,
      closed_at_paris: data.closed_at_paris || null,
      exit_price: data.exit_price ?? null,
      exit_reason: data.exit_reason || null,
      realized_r: data.realized_r ?? data.realized_R ?? data.result_r ?? null,
      mfe_r: data.mfe_r ?? null,
      mae_r: data.mae_r ?? null,
      latest_management_action: data.latest_management_action || null,
    };
  }
  if (collection === "desk_replay_setups") {
    return {
      ...common,
      setup_id: data.setup_id || documentId,
      instrument: data.instrument || null,
      direction: data.direction || null,
      entry_zone: data.entry_zone || null,
      entry_execution_price: data.entry_execution_price ?? null,
      stop_loss: data.stop_loss ?? null,
      targets: data.take_profits || data.targets || [data.take_profit_1].filter(Boolean),
      minimum_rr: data.minimum_rr ?? null,
      setup_type: data.setup_type || null,
      valid_from_paris: data.valid_from_paris || data.valid_from || null,
      expires_at_paris: data.expires_at_paris || data.expires_at || data.valid_until || null,
      conditions: data.conditions || [],
      trigger_policy: data.trigger_policy || null,
      management: data.management || null,
      linked_position_id: data.linked_position_id || null,
    };
  }
  const update = data.position_update || null;
  return {
    ...common,
    simulation_id: data.simulation_id || documentId,
    from_timestamp: data.from_timestamp || null,
    to_timestamp: data.to_timestamp || null,
    position_id: data.position_id || data.position_update?.position_id || null,
    result: data.result || null,
    setup_evaluations: data.setup_evaluations || [],
    datasets: data.datasets || [],
    max_price_timestamp_used: data.max_price_timestamp_used || null,
    future_prices_used: data.future_prices_used ?? null,
    position_update: update ? {
      status: update.status || null,
      instrument: update.instrument || null,
      direction: update.direction || null,
      entry_price: update.entry_price ?? null,
      stop_loss: update.stop_loss ?? null,
      take_profit_1: update.take_profit_1 ?? null,
      exit_price: update.exit_price ?? null,
      exit_reason: update.exit_reason || null,
      realized_r: update.realized_r ?? update.realized_R ?? update.result_r ?? null,
      mfe_r: update.mfe_r ?? null,
      mae_r: update.mae_r ?? null,
    } : null,
  };
}
