#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeskStoreFromEnv } from "../src/store.js";

const args = parseArgs(process.argv.slice(2));
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

await loadEnvFile(resolve(args.env || join(PROJECT_ROOT, ".env")));

if (args.help || !args.backtest_id) {
  console.error("Usage: node scripts/replay_autopilot_codex_agent.mjs --backtest-id <id> [--execute] [--max-transitions 6] [--worker-id gpt-replay-worker]");
  process.exit(args.help ? 0 : 2);
}

const store = createDeskStoreFromEnv();
const maxTransitions = clampInt(args.max_transitions ?? args["max-transitions"] ?? 6, 1, 12);
const workerId = args.worker_id || args["worker-id"] || "gpt-replay-worker";
const execute = args.execute === true || args.execute === "true";

const before = await store.getReplayState({ backtest_id: args.backtest_id });
let automation = null;
if (execute) {
  automation = await store.driveReplayAutomation({
    backtest_id: args.backtest_id,
    max_transitions: maxTransitions,
  });
}
const state = await store.getReplayState({ backtest_id: args.backtest_id });

const prompt = buildGptReplayWorkerPrompt({
  state,
  workerId,
  maxTransitions,
  automation,
});

const result = {
  ok: true,
  mode: execute ? "execute" : "dry_run",
  backtest_id: args.backtest_id,
  before: summarizeState(before),
  after: summarizeState(state),
  automation,
  gpt_prompt: prompt,
};

if (args.prompt_only || args["prompt-only"]) {
  console.log(prompt);
} else {
  console.log(JSON.stringify(result, null, 2));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replaceAll("-", "_");
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

async function loadEnvFile(path) {
  const text = await readFile(path, "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = unquoteEnvValue(match[2].trim());
  }
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function clampInt(value, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function summarizeState(state) {
  return {
    status: state.status,
    next_action: state.next_action,
    replay_time: state.replay_time,
    current_step_id: state.current_step_id,
    current_work_item_id: state.current_work_item?.work_item_id || null,
    current_workflow: state.current_work_item?.workflow || null,
    recommended_minutes: state.recommended_replay_cadence?.recommended_minutes ?? null,
    setup_status: state.replay_continuity?.setup_status || null,
    position_status: state.replay_continuity?.position_status || null,
    thesis_health_score: state.active_thesis?.health_score ?? null,
  };
}

function buildGptReplayWorkerPrompt({ state, workerId, automation }) {
  const workflow = state.current_work_item?.workflow || "REPLAY_MASTER_OR_MONITOR";
  const status = state.status;
  const workItemId = state.current_work_item?.work_item_id || "à réclamer";
  const cadence = state.recommended_replay_cadence?.recommended_minutes ?? "backend";
  const continuity = state.replay_continuity || {};
  const checkpoints = (state.event_checkpoints || []).slice(0, 5).map((checkpoint) => checkpoint.checkpoint_paris || checkpoint).join(", ") || "aucun";

  return `Rôle : tu es le worker GPT Replay pour le Desk Futures. Tu exécutes un seul cycle, sans inventer de données, puis tu t'arrêtes.

Scope strict :
- backtest_id : ${state.selected_backtest?.backtest_id || state.selected_backtest?.replay_run_id || "UNKNOWN"}
- workflows autorisés : REPLAY_MASTER, REPLAY_MONITOR uniquement
- worker_id : ${workerId}
- état backend actuel : ${status}
- work_item attendu : ${workItemId}
- workflow attendu : ${workflow}
- replay_time : ${state.replay_time || "UNKNOWN"}
- cadence backend recommandée : ${cadence} min
- setup_status backend : ${continuity.setup_status || "WAIT_NO_SETUP"}
- position_status backend : ${continuity.position_status || "NO_POSITION"}
- prochains checkpoints connus : ${checkpoints}

Pile obligatoire pour les nouveaux runs : Master V5, Monitor V2, Execution Plan V1, Monitor Command V1, Policy V4, Catalog V1, profil OPPORTUNITY_SEEKING_CONTROLLED. LIVE et REPLAY partagent la même sémantique; seule l'acquisition temporelle diffère. Si le work item pointe une autre pile, arrête CONTRACT_VERSION_UNEXPECTED sans conversion implicite.

Procédure obligatoire :
1. Appelle desk_ping. Si le MCP Desk Futures Data n'est pas disponible, ARRÊT sans analyse ni écriture.
2. Appelle claim_next_replay_work avec :
   { "worker_id": "${workerId}", "workflows": ["REPLAY_MASTER", "REPLAY_MONITOR"], "backtest_id": "${state.selected_backtest?.backtest_id || ""}", "lease_seconds": 660 }
3. Si aucun work n'est dû, réponds NO_WORK et n'écris rien.
4. Si le claim retourne REPLAY_MASTER :
   - lis le bundle fourni par le claim ou via get_replay_master_bundle ;
   - produis le Master replay au cutoff exact, sans lookahead ;
   - sauvegarde avec save_replay_master_analysis en réutilisant strictement save_target ;
   - termine avec complete_replay.
5. Si le claim retourne REPLAY_MONITOR :
   - lis le bundle fourni par le claim ou via get_replay_monitor_bundle ;
   - utilise replay_continuity comme source de vérité pour le setup, la position et la thèse active ;
   - produis monitor_output V2 dont command est l'unique Monitor Command V1 ;
   - recopie command_id, monitor_id, plan_id et expected_revision exacts; expected_revision est un compare-and-swap, jamais une valeur à incrémenter ;
   - NO_ACTION impose les quatre branches à null; UPSERT_CANDIDATE, PRE_ARM, ARM et REPLACE exigent setup_transition.setup complet ;
   - sauvegarde avec save_replay_monitor en réutilisant strictement save_target ;
   - termine avec complete_replay.
6. En cas d'erreur récupérable, appelle fail_replay avec error_code et message court. N'invente aucun id, prix, bundle_id, analysis_id, thesis_id ou monitor_id.

Règles V5/V2 importantes :
- Recherche jusqu'à trois candidats réellement distincts classés rank 1..3; le seuil contextuel pondéré est 0.55. Une source facultative absente reste soft et ne suffit pas à imposer WAIT_NO_SETUP.
- Le risque demandé reste >0 et <=0.25% de NET_EQUITY, stop obligatoire, RR recalculé>=2. Le broker seul calcule les contrats entiers par ceil et refuse tout excédent supérieur à max_rounding_excess_pct.
- Chaque setup contient géométrie, toutes les cibles/actions, conditions, management, validité et preuves. Une prose n'est jamais exécutable.
- Chaque condition utilise uniquement predicate_type/operator/role/effect/importance/memory_policy/timeframe du Catalog V1 et tous ses parameters typés, temporal_rule, weight, sequence et evidence_refs.
- EVENT_BLACKOUT requis sans données décidables reste UNKNOWN et bloque seulement ENTRY_TRIGGER. Les gates futures ne suppriment pas un candidat avant leur phase.
- VETO temporaire (EVENT_BLACKOUT, fenêtre, intermarket, volatilité) utilise LATEST_ONLY, se lève quand faux et exige une confirmation M1 fraîche. INVALIDATION structurelle seule utilise INVALIDATE_TERMINAL; LATCH_UNTIL_TRIGGER est interdit à BLOCK_IF_TRUE.
- Aucun effet soft n'est caché : REQUIRE_CONFIRMATION exige une condition Catalog V1 explicite; REDUCE_RISK exige un nouveau plan dont risk.risk_pct_requested est abaissé avant compilation. Sinon l'effet reste advisory et jamais veto.
- GPT analyse les checkpoints planifiés M15; le moteur rejoue chaque M1 fermée. Confirmation same-bar interdite; toute réacquisition après sortie de zone est réévaluée.
- WAIT_NO_SETUP exige no_setup_proof complet avec best_long, best_short, blocking_reasons, wait_to_go_conditions structurées et revalidation_triggers.
- GPT ne produit jamais ENGINE_TRIGGER, fill, position, quantité, ordre broker, résultat R, hash compilé ou diagnostics.

Résumé Codex avant déclenchement :
${automation ? JSON.stringify(automation, null, 2) : "dry_run : Codex n'a pas exécuté driveReplayAutomation pendant ce cycle."}
`;
}
