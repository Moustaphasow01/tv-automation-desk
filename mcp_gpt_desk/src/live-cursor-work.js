import { createHash } from "node:crypto";

export const DESK_LIVE_PROMPT_VERSION = "1.2.0";

export function buildLiveCursorWork({ bundle, plan }) {
  const workflow = plan.workflow;
  const master = workflow === "LIVE_MASTER";
  const saveTarget = bundle.save_target || {};
  const suggested = saveTarget.suggested_payload || {};
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
    cursor_id: `livecur__${tradingDate}__${bundle.session}`,
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
      ? { ...commonBundleArgs, cutoff_paris: bundle.cutoff_paris, include_raw_refs: false }
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
    `1. Appelle ${work.bundle_tool} avec exactement bundle_args, en vue compacte et sans refs raw.`,
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
    ...(work.workflow === "LIVE_MASTER" ? [
      "10. Pour LIVE_MASTER, execute aussi les saves obligatoires du contrat, notamment save_active_thesis, avant complete_live.",
      "11. Ne considere jamais le Master live termine tant que la these active n'est pas materialisee.",
    ] : []),
    "",
    "Regles de donnees:",
    "- Seul missing_unexpected est une panne de source.",
    "- stale_market_closed et not_yet_open sont des etats normaux de session.",
    "- last_known/H4 sert au contexte, jamais a un trigger frais.",
    "- Un gap technologique est non applicable avant la premiere cotation courante.",
    "- Le VIX cash ferme ne bloque pas seul l'analyse.",
    "- Aucun JSON ne doit etre rendu a l'operateur pour etre copie dans le front.",
    "- Le save live doit conserver strategy_id, trading_date, session, run_id, as_of_utc, timezone et pack_build_id du bundle.",
    "",
    "Horizon d'analyse et construction des setups:",
    "- La cadence operationnelle du worker est horaire. Le checkpoint M15 represente la derniere donnee cloturee disponible, pas une obligation de produire une these de scalping M15.",
    "- Analyse en priorite la session entiere, le delta depuis la derniere analyse materialisee, la derniere heure et le contexte des quatre dernieres heures.",
    "- La structure H4/H1 porte le biais et l'invalidation strategique; M15 confirme l'acceptation ou le rejet; M5 sert uniquement a affiner l'execution.",
    "- Privilegie des setups intraday capables de rester valides pendant plusieurs bougies M15, avec un objectif de mouvement de session, plutot qu'un mouvement de quelques minutes.",
    "- N'elargis jamais artificiellement le stop pour donner une apparence intraday: la geometrie, le risque et le RR du contrat restent obligatoires.",
    "- Si seul un micro-mouvement de scalp est disponible ou si le RR intraday n'est pas propre, conserve WAIT ou un setup candidat non executable.",
    ...(work.workflow === "LIVE_M15_MONITOR" ? [
      "- Pour un monitor horaire, agrege les changements intervenus depuis le dernier monitor materialise et ne surpondere jamais la seule derniere bougie M5/M15.",
    ] : []),
    ...(work.catchup_context ? [
      `- Mode rattrapage: analyse le delta complet de ${work.catchup_context.master_cutoff_paris} a ${work.catchup_context.monitor_checkpoint_paris}.`,
      `- Les ${work.catchup_context.skipped_checkpoint_count || 0} checkpoints ignores sont audites et ne doivent pas etre rejoues individuellement.`,
    ] : []),
  ].join("\n");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
