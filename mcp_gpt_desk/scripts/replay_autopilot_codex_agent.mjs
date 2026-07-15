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

Procédure obligatoire :
1. Appelle desk_ping. Si le MCP Desk Futures Data n'est pas disponible, ARRÊT sans analyse ni écriture.
2. Appelle claim_next_desk_work avec :
   { "worker_id": "${workerId}", "workflows": ["REPLAY_MASTER", "REPLAY_MONITOR"], "backtest_id": "${state.selected_backtest?.backtest_id || ""}", "lease_seconds": 660 }
3. Si aucun work n'est dû, réponds NO_WORK et n'écris rien.
4. Si le claim retourne REPLAY_MASTER :
   - lis le bundle fourni par le claim ou via get_replay_master_bundle ;
   - produis le Master replay au cutoff exact, sans lookahead ;
   - sauvegarde avec save_replay_master_analysis en réutilisant strictement save_target ;
   - termine avec complete_desk_work.
5. Si le claim retourne REPLAY_MONITOR :
   - lis le bundle fourni par le claim ou via get_replay_monitor_bundle ;
   - utilise replay_continuity comme source de vérité pour savoir s'il existe un setup, une position, ou une thèse active ;
   - si tu proposes un setup candidat/pré-armé/armé, fournis un objet structuré setup_candidate, setup_transition ou armed_setup ;
   - classe chaque condition en HARD_BLOCKER, MANDATORY, PRIMARY, SECONDARY, OPTIONAL ou ADVISORY ;
   - seules les conditions structurées avec operator/threshold/field + entry/stop/take_profit pourront être simulées par le backend entre deux monitors ;
   - sauvegarde avec save_replay_monitor en réutilisant strictement save_target ;
   - termine avec complete_desk_work.
6. En cas d'erreur récupérable, appelle fail_desk_work avec error_code et message court. N'invente aucun id, prix, bundle_id, analysis_id, thesis_id ou monitor_id.

Règles setup importantes :
- Toutes les conditions ne sont pas obligatoires. Mets mandatory seulement sur les vrais verrous.
- Une condition optionnelle/advisory peut renforcer ou affaiblir le risque, mais ne doit pas bloquer seule un setup.
- Si tu veux que le backend puisse déclencher entre deux monitors, donne une condition backend-évaluable : instrument, field, operator, threshold, direction, entry_price, stop_loss, take_profit_1, expiry.
- Si aucune position n'est ouverte, ne dis pas "si un setup est déjà engagé" : lis replay_continuity et décide à partir de l'état backend.

Résumé Codex avant déclenchement :
${automation ? JSON.stringify(automation, null, 2) : "dry_run : Codex n'a pas exécuté driveReplayAutomation pendant ce cycle."}
`;
}
