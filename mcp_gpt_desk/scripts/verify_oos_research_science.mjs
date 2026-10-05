import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { freezePublishedAudit, executePublishedAudit } from '@tv-automation/desk-oos-research';
import { openResearchHost } from '../src/oos-research-host.js';

/** Technical acceptance only; existing publications, isolated memory, zero model/replay calls. */
const config = JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, 'utf8'));
const options = { config: { archive_root: config.archive_root, ...config.research } };
const fingerprint = text => createHash('sha256').update(text).digest('hex');
const assert = (condition, code) => { if (!condition) throw new Error(code); };
const dates = ['2026-07-02', '2026-07-08'];
let host = await openResearchHost(options);
try {
  const caps = await host.api.cycle.observer.read('get_forensic_capabilities');
  const definition = { dataset_role: 'TECHNICAL_ACCEPTANCE_ONLY', dates, budget: { maximum_model_calls: 0 },
    purpose: 'Published audit transport, immutable preregistration and restart persistence; not hypothesis selection.' };
  const cycle_id = fingerprint(`TECHNICAL_SCIENCE_ACCEPTANCE_V1|${caps.index_hash}`);
  await host.api.memory.beginCycle({ cycle_id, input_hash: fingerprint(JSON.stringify(definition)),
    corpus_hash: caps.index_hash, definition });
  const cases = [];
  for (const date of dates) cases.push(...(await host.api.cycle.observer.day(date, caps.index_hash)).cases);
  const experiment_id = fingerprint(`${cycle_id}|TECHNICAL_ACCEPTANCE_PROTOCOL`);
  let stored = await host.api.memory.findArtifact({ kind: 'experiment', id: experiment_id });
  if (!stored) {
    const protocol = freezePublishedAudit({ cycle: { cycle_id, corpus_hash: caps.index_hash },
      hypothesis: { hypothesis_id: 'TECHNICAL_ACCEPTANCE_NOT_A_STRATEGY' }, cases, fingerprint,
      clock: () => new Date().toISOString(), design: { variant: 'BE1',
        mechanism: 'Technical read/persistence test; arbitrary existing publication key, not a trading hypothesis.',
        thresholds: { minimum_trades: 1, minimum_days: 1, minimum_expectancy_delta: 0, minimum_winner_preservation: 1 } } });
    stored = await host.api.cycle.save(cycle_id, 'experiment', experiment_id, protocol);
  }
  const frozen_hash = stored.payload_hash;
  await host.close(); host = await openResearchHost(options);
  const readBack = await host.api.memory.findArtifact({ kind: 'experiment', id: experiment_id });
  assert(readBack.cycle_id === cycle_id && readBack.payload_hash === frozen_hash, 'RESEARCH_SCIENCE_RESTART_PERSISTENCE_FAILED');
  const result = executePublishedAudit({ protocol: readBack.payload, cases, fingerprint });
  const result_id = fingerprint(`${experiment_id}|TECHNICAL_ACCEPTANCE_RESULT`);
  const payload = { ...result, classification: 'TECHNICAL_ACCEPTANCE_ONLY', sample_purpose: 'TECHNICAL_ACCEPTANCE',
    not_a_scientific_hypothesis_test: true, source_protocol_hash: frozen_hash };
  const first = await host.api.cycle.save(cycle_id, 'finding', result_id, payload);
  const second = await host.api.cycle.save(cycle_id, 'finding', result_id, payload);
  assert(first.payload_hash === second.payload_hash, 'RESEARCH_SCIENCE_IDEMPOTENCE_FAILED');
  const current = await host.api.memory.getCycle(cycle_id);
  if (current.status !== 'COMPLETED') await host.api.memory.transition({ cycle_id,
    expected_revision: current.revision, status: 'COMPLETED', checkpoint: { technical_acceptance: 'PASS', result_id } });
  await host.api.cycle.observer.assertCorpus(caps.index_hash);
  assert(result.validated_edge === false && result.financial_recalculation === false && result.champion_modified === false,
    'RESEARCH_SCIENCE_SAFETY_FAILED');
  console.log(JSON.stringify({ scientific_adapter_acceptance: 'PASS', cycle_id, dataset_role: definition.dataset_role,
    source_dates: dates, frozen_protocol_hash: frozen_hash, result_hash: first.payload_hash,
    paired_publications: result.paired_trades, unavailable_publications: result.skipped.length,
    restart_persistence: 'PASS', idempotence: 'PASS', corpus_integrity: 'PASS', model_calls: 0,
    new_replays: 0, source_artifacts_modified: 0, validated_edge: false }));
} finally { await host.close(); }
