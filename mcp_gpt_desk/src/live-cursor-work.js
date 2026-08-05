import { createHash } from "node:crypto";
import { dailyCursorId } from "./daily-run-model.js";
import { deskDataAvailabilityWorkerRules } from "./data-availability-policy.js";
import {
  ACTIVE_STRATEGY_RUNTIME_VERSIONS,
  assertActiveStrategyContractContext,
  assertActiveStrategySaveTarget,
} from "./strategy-runtime-versioning.js";

export const DESK_LIVE_PROMPT_VERSION = "2.4.0";

export function buildLiveCursorWork({ bundle, plan }) {
  const workflow = plan.workflow;
  const master = workflow === "LIVE_MASTER";
  const saveTarget = bundle.save_target || {};
  const suggested = saveTarget.suggested_payload || {};
  assertActiveStrategyContractContext(bundle.contract_context, {
    workflow,
    operation: "build_live_cursor_work",
  });
  assertActiveStrategySaveTarget(suggested, {
    workflow,
    mode: "live",
    operation: "build_live_cursor_work",
  });
  const tradingDate = bundle.trading_date || bundle.date;
  const checkpoint = plan.checkpoint;
  const commonBundleArgs = {
    bundle_id: bundle.bundle_id,
    strategy_id: bundle.strategy_id,
    session: bundle.session,
    mode: bundle.mode || "live",
    trading_date: tradingDate,
    run_id: bundle.run_id,
    as_of_utc: bundle.as_of_utc,
    timezone: bundle.timezone || "Europe/Paris",
  };
  const work = {
    workflow,
    cursor_id: dailyCursorId(tradingDate),
    run_scope: "full_day",
    phase: plan.phase || bundle.phase || bundle.session,
    checkpoint,
    run_id: bundle.run_id,
    strategy_id: bundle.strategy_id,
    trading_date: tradingDate,
    session: bundle.session,
    cutoff_paris: bundle.cutoff_paris || bundle.timestamp_paris || checkpoint,
    pack_build_id: suggested.pack_build_id || bundle.pack_build_id || null,
    bundle_id: bundle.bundle_id,
    bundle_tool: master ? "get_master_cutoff_bundle" : "get_manual_monitor_bundle",
    bundle_args: master
      ? {
          ...commonBundleArgs,
          cutoff_paris: bundle.cutoff_paris,
          include_raw_refs: false,
        }
      : {
          ...commonBundleArgs,
          timestamp_paris: bundle.timestamp_paris,
          master_id: suggested.linked_master_analysis_id,
          thesis_id: suggested.linked_active_thesis_id,
          ...(suggested.pack_id ? { pack_id: suggested.pack_id } : {}),
          include_raw_refs: false,
        },
    save_tool: saveTarget.tool,
    save_target: suggested,
    contract_context: bundle.contract_context,
    runtime_versions: ACTIVE_STRATEGY_RUNTIME_VERSIONS,
    catchup_context: bundle.catchup_context || null,
    prompt_name: master ? "DeskLiveMasterAgentPrompt" : "DeskLiveM15MonitorAgentPrompt",
    prompt_version: DESK_LIVE_PROMPT_VERSION,
  };
  const executionPrompt = buildLiveCursorPrompt(work);
  return {
    ...work,
    execution_prompt: executionPrompt,
    prompt_hash: sha256(executionPrompt),
  };
}

function buildLiveCursorPrompt(work) {
  const contract = work.contract_context || {};
  const nativeV5 = (work.workflow === "LIVE_MASTER"
      && String(contract.schema_version) === ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract)
    || (work.workflow !== "LIVE_MASTER"
      && String(contract.schema_version) === ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract);
  const catchupFrom = work.catchup_context?.analysis_window?.from_paris
    || work.catchup_context?.master_cutoff_paris
    || work.catchup_context?.previous_materialized_checkpoint_paris
    || null;
  const catchupTo = work.catchup_context?.analysis_window?.to_paris
    || work.catchup_context?.monitor_checkpoint_paris
    || work.checkpoint;
  return [
    "Tu executes un travail automatise du Desk Futures en mode live.",
    "Le backend est l'unique source de continuite, de scope, de revision et d'idempotence.",
    "N'invente aucun identifiant et n'utilise jamais de donnees replay.",
    "",
    `Workflow: ${work.workflow}`,
    `Cursor: ${work.cursor_id}`,
    `Checkpoint: ${work.checkpoint}`,
    `Run: ${work.run_id}`,
    `Bundle: ${work.bundle_id}`,
    `Cutoff Paris: ${work.cutoff_paris}`,
    `Bundle tool: ${work.bundle_tool}`,
    `Save tool: ${work.save_tool}`,
    `Contrat: ${contract.contract_name || "inconnu"} v${contract.schema_version || "inconnue"}`,
    `Contract hash: ${contract.contract_hash || "inconnu"}`,
    `Pack build: ${work.pack_build_id}`,
    "",
    "Sequence obligatoire:",
    "Le backend a deja resolu et fige le contrat actif dans contract_context lors de la preparation du claim.",
    "Ne rappelle pas get_active_contracts ni get_contract dans un cycle curseur LIVE; le required_first_tool du bundle est deja satisfait par cette preparation backend.",
    `1. Appelle ${work.bundle_tool} avec exactement bundle_args. Le backend selectionne la vue compacte retrocompatible parce que bundle_id est epingle et include_raw_refs=false.`,
    "1b. Si le bundle retourne required_followup_reads, execute-les tous avec leurs arguments exacts avant l'analyse. Une section omise par budget n'est jamais une donnee absente.",
    `2. Verifie que contract_context correspond exactement a ${contract.contract_name || "le contrat du claim"} v${contract.schema_version || "la version du claim"} et au hash ${contract.contract_hash || "du claim"}.`,
    "3. Verifie pack_build_id, source coverage, data_quality et anti-lookahead.",
    "4. Utilise uniquement les lectures live-scoped du meme run_id et cutoff si un approfondissement est necessaire.",
    "5. Copie integralement bundle.save_target.suggested_payload sans retirer de champ, notamment strategy_id, trading_date, session, run_id, as_of_utc, timezone et pack_build_id; ajoute seulement les resultats analytiques et le handle.",
    ...(work.workflow === "LIVE_M15_MONITOR" ? [
      "- Pour save_manual_monitor, conserve status=SAVED fourni par suggested_payload; ready/READY est un etat de preparation et n'est jamais un statut de sauvegarde.",
    ] : []),
    `6. Complete l'analyse conforme au contrat puis appelle ${work.save_tool} directement par MCP.`,
    "7. Ajoute au save cursor_id, checkpoint, worker_id et lease_token retournes par le claim.",
    "8. Apres le save reussi, appelle complete_live avec les memes cursor_id, checkpoint, worker_id et lease_token.",
    "9. En cas d'echec, appelle fail_live avec un code structure et termine.",
    ...(work.workflow === "LIVE_MASTER" ? nativeV5 ? [
      "10. Pour LIVE_MASTER V5.4, analysis_output.active_thesis est obligatoire et le backend la materialise atomiquement avec le Master; n'appelle aucun save supplementaire.",
      "11. supplementary_writes_json vaut exactement [] et complete_live verifie la materialisation atomique.",
    ] : [
      "10. Pour un LIVE_MASTER legacy, execute aussi les saves obligatoires du contrat, notamment save_active_thesis, avant complete_live.",
      "11. Ne considere jamais le Master legacy termine tant que la these active n'est pas materialisee.",
    ] : []),
    "",
    "Regles de donnees:",
    ...deskDataAvailabilityWorkerRules(),
    "- Un gap technologique est non applicable avant la premiere cotation courante.",
    "- Le VIX cash ferme ne bloque pas seul l'analyse.",
    "- Aucun JSON ne doit etre rendu a l'operateur pour etre copie dans le front.",
    "- Le save live doit conserver strategy_id, trading_date, session, run_id, as_of_utc, timezone et pack_build_id du bundle.",
    "",
    ...(nativeV5 ? [
      "Contrat d'execution actif Master V5.4 / Monitor V2.4, Plan V1.4, Command V1.4, Policy V4.3 et Catalog V1.2:",
      "- Profil OPPORTUNITY_SEEKING_CONTROLLED: recherche activement zero a cinq candidats distincts classes rank 1..5; score contextuel 0.55; une confirmation facultative absente reste soft et ne suffit pas a produire WAIT_NO_SETUP.",
      "- La tolerance ne change pas le risque: risk_pct_requested>0 et <=0.25% de NET_EQUITY, stop obligatoire, RR recalcule>=2. Le broker seul calcule les contrats entiers par ceil et bloque si rounding_excess_percent depasse max_rounding_excess_pct.",
      "- GPT ne produit jamais ENGINE_TRIGGER, TRIGGERED, CLOSED, fill, position, quantite, ordre broker, resultat R, hash compile ni diagnostics. Le backend M1 et le broker sont seuls autorises a les materialiser.",
      "- Tout setup contient setup_id epingle, rank, requested_state, pattern, instrument, direction, order_type, entry_mode, entry.price ou entry.zone_lower+zone_upper, stop.type+price, toutes les targets avec action+close_fraction (PARTIAL_CLOSE strictement entre 0 et 1 ; FULL_CLOSE toujours égal à 1 car il ferme tout le reliquat), rr_expected, conditions, management, validity, rationale et evidence_refs.",
      "- Chaque condition utilise exclusivement predicate_type, operator, role, effect, importance, memory_policy et timeframe du Catalog V1.2; fournis tous les parameters, temporal_rule, weight, sequence et evidence_refs. La prose n'est jamais executable.",
      "- VETO temporaire (EVENT_BLACKOUT, TIME_WINDOW, intermarket, volatilite) utilise BLOCK_IF_TRUE, required_for_trigger=false, weight=0, memory_policy=LATEST_ONLY; il se leve quand faux puis exige une confirmation M1 fraiche.",
      "- INVALIDATION est reservee a une rupture structurelle explicite avec INVALIDATE_TERMINAL. LATCH_UNTIL_TRIGGER est interdit a tout BLOCK_IF_TRUE; MANDATORY d'activation/confirmation utilise REQUIRE_TRUE.",
      "- Les 12 hard gates gardent leur phase: PLAN_COMPILE, SETUP_ARM, ENTRY_TRIGGER ou BROKER_SUBMIT. Une gate future ne supprime pas le candidat avant sa phase.",
      "- EVENT_BLACKOUT requis sans donnee decidable reste UNKNOWN et bloque seulement ENTRY_TRIGGER; les donnees contextuelles facultatives absentes restent soft.",
      "- Une confirmation ne permet jamais une entree sur la meme bougie M1. NEXT_BAR attend la bougie M1 fermee suivante; un retest ou une reacquisition apres sortie de zone doit etre prouve a nouveau par les predicats machine.",
      "- Aucun effet soft n'est cache: REQUIRE_CONFIRMATION exige une condition Catalog V1.2 explicite; REDUCE_RISK exige un nouveau plan avec risk.risk_pct_requested abaisse avant compilation, sinon il reste advisory et jamais veto.",
      "- Monitor V2.4 recopie command_id, plan_id, monitor_id et expected_revision exacts. expected_revision est un compare-and-swap: ne l'incremente et ne le devine jamais.",
      "- WAIT_NO_SETUP exige no_setup_proof complet avec best_long, best_short, blocking_reasons, wait_to_go_conditions structurees et revalidation_triggers.",
    ] : [
      "Contrat d'execution legacy epingle:",
      "- Respecte strictement son schema sans convertir implicitement vers V5/V2.",
      "- GPT ne confirme jamais TRIGGERED, CLOSED, fill, position ou resultat R; le backend reste autorite d'execution.",
    ]),
    "",
    "Horizon d'analyse et construction des setups:",
    "- La cadence analytique GPT planifiee est M15, avec un Monitor additionnel sur evenement moteur critique. Le moteur deterministe partage exactement la meme logique LIVE/REPLAY et surveille les setups et positions sur chaque cloture M1; seule l'acquisition temporelle des donnees differe.",
    "- Analyse en priorite la session entiere, le delta depuis la derniere analyse materialisee, la derniere heure et le contexte des quatre dernieres heures.",
    "- La structure H4/H1 porte le biais et l'invalidation strategique; M15 rafraichit l'analyse GPT planifiee; M1 reste reserve a l'execution deterministe et peut demander un Monitor critique entre deux checkpoints.",
    "- Privilegie des setups intraday capables de rester valides pendant plusieurs bougies M15, avec un objectif de mouvement de session, plutot qu'un mouvement de quelques minutes.",
    "- N'elargis jamais artificiellement le stop pour donner une apparence intraday: la geometrie, le risque et le RR du contrat restent obligatoires.",
    "- Si seul un micro-mouvement de scalp est disponible ou si le RR intraday n'est pas propre, conserve WAIT ou un setup candidat non executable.",
    ...(work.workflow === "LIVE_M15_MONITOR" ? nativeV5 ? [
      "- Pour chaque Monitor V2.4 planifie en GPT M15 ou declenche par un evenement critique, compare le realise au plan precedent et integre les snapshots M1 backend sans recalculer ni inventer leurs etats.",
      "- monitor_output.command est l'unique Command V1.4. requested_action=NO_ACTION exige setup_transition, transformation, replan_request et management_request a null.",
      "- UPSERT_CANDIDATE, PRE_ARM, ARM et REPLACE exigent setup_transition.setup complet conforme au Plan V1; ARM signifie seulement ARMED_CONDITIONAL.",
      "- CANCEL, EXPIRE et INVALIDATE ciblent le setup_id canonique existant. REPLACE utilise un nouveau setup_id et un replaces_setup_id distinct.",
      "- Toute demande de position reste GPT_REQUEST_ONLY. Reutilise les identites epinglees et expected_revision exact; ne duplique jamais un scenario a chaque Monitor.",
    ] : [
      "- Pour chaque monitor legacy, compare le realise au plan precedent et respecte strictement le contrat epingle.",
      "- N'utilise jamais TRIGGER_GO; une transition executable reste structuree et le moteur decide du fill.",
    ] : []),
    ...(work.catchup_context ? [
      `- Mode rattrapage latest-wins: analyse le delta complet de ${catchupFrom || "la derniere sortie materialisee"} a ${catchupTo}.`,
      `- Le checkpoint selectionne ${work.checkpoint} est le Monitor ferme le plus recent; ne rejoue jamais individuellement un Monitor plus ancien.`,
      `- Les ${work.catchup_context.skipped_checkpoint_count || 0} checkpoints non materialises (${(work.catchup_context.skipped_checkpoints || []).join(", ") || "aucun"}) sont explicitement audites comme superseded.`,
      "- Integre leurs donnees de marche dans l'analyse cumulee, signale le trou de materialisation et compare le checkpoint courant a la derniere sortie reellement materialisee.",
    ] : []),
  ].join("\n");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
