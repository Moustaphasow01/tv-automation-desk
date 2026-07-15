export const DESK_METHODOLOGY_VERSION = "DeskFuturesAnalysisContract v1.1.0";

export const DESK_BACKFORWARD_METHODOLOGY = `# Desk Futures Data - Methodologie obligatoire GPT

Version: DeskFuturesAnalysisContract v1.1.0
Timezone: Europe/Paris

Avant toute analyse backforward, live, replay ou Asia Open, tu dois appliquer cette methode dans l'ordre. Tu ne dois pas recuperer un pack puis prendre une decision sans respecter cet entonnoir.

## Workflow obligatoire

1. Appeler get_desk_methodology.
2. Appeler list_available_exports si l'utilisateur demande une periode ou un backforward.
3. Selectionner le pack exact avec get_desk_pack.
4. Lire les datasets necessaires avec get_dataset, notamment:
   - MNQ_M5, MES_M5
   - NQ_M15, NQ_H1, NQ_H4
   - ES_M15, ES_H1, ES_H4
   - MNQ_H4, MES_H4
   - US10Y_US02Y, US10Y_US02Y_H4
   - DXY_CL_GC_VIX, DXY_CL_GC_VIX_H4
   - indices_asie_europe, indices_asie_europe_H4
   - mega_caps_premarket, mega_caps_premarket_H4
   - macro_calendar
5. Construire market_funnel puis decision_gates.
6. Produire le rapport humain.
7. Sauvegarder uniquement si l'analyse est conforme.

## Entonnoir marche obligatoire

1. Calendrier / macro: lire J-1, J, J+1. Utiliser les actuals uniquement s'ils sont presents dans le pack comme visibles au cutoff (published_at_paris/actual_published_at_paris <= data_cutoff_paris). Ignorer tout actual masque ou publie apres le cutoff.
2. Taux / dollar / volatilite: US10Y, US02Y, DXY, VIX, puis CL et GC.
3. Indices globaux: Nikkei, Hang Seng, DAX, Euro Stoxx, ES/NQ.
4. Mega caps et semis: NVDA, AAPL, MSFT, TSLA, SMH, SOXX. Couche obligatoire pour tout trade MNQ/NQ.
5. Futures noyau: MNQ, NQ, MES, ES en M5, M15, H1, H4.
6. Relative strength: MNQ vs MES et NQ vs ES. La faiblesse relative n'est jamais un trigger executable seule.
7. Structure HTF: H4/H1 donnent le regime; M15 valide la zone; M5 execute seulement.
8. Zone et trigger: aucune entree sans zone, trigger, invalidation et RR propres.
9. Decision executable: prendre seulement si les gates sont valides; sinon wait.

## Gates bloquants

- Si data_quality est degraded ou si un dataset critique manque: decision wait.
- Si les indicateurs clefs sont nuls ou absents: decision wait.
- Si mega caps/semis sont attendus ouverts et availability=missing_unexpected pour un trade MNQ/NQ: decision wait.
- Si mega caps/semis sont not_yet_open ou stale_market_closed: utiliser last_known/H4 comme contexte, sans les compter comme confirmation fraiche ni comme panne de donnees.
- Un gap technologique n'est applicable qu'apres la premiere cotation de la session courante.
- Le VIX cash ferme ne bloque pas seul une analyse Asia Open; utiliser son dernier contexte et signaler l'absence de confirmation fraiche.
- Si macro_calendar est absent ou contient un actual visible publie apres le cutoff: decision wait.
- Si le rapport/contrat n'inclut pas market_funnel et decision_gates: ne pas appeler save_desk_analysis.
- Si preferred_instrument vaut WAIT, il faut une justification supplementaire et des gates forts pour passer a prendre.

## Contrat de sortie

Toute analyse sauvegardee doit contenir:
- schema_version: "1.1.0"
- contract_name: "DeskFuturesAnalysisContract"
- market_funnel complet
- decision_gates complet
- executable_decision unique
- setups executables ou explicitement non executables
- session_matrix
- authorized_windows_summary
- update_agenda
- risk_management
- monitoring_rules
- final_sections

Regle finale: GPT ne doit jamais inventer une confirmation globale. Chaque biais doit citer une preuve issue du pack ou rester en WAIT.`;

export function getDeskMethodology() {
  return {
    ok: true,
    version: DESK_METHODOLOGY_VERSION,
    contract_name: "DeskFuturesAnalysisContract",
    schema_version: "1.1.0",
    prompt: DESK_BACKFORWARD_METHODOLOGY,
    required_first_tool_for_backforward: "get_desk_methodology",
    anti_lookahead_policy: {
      macro_calendar: "Use macro actuals only when published_at_paris/actual_published_at_paris <= data_cutoff_paris; ignore hidden or post-cutoff actuals.",
      hard_gate: true,
    },
  };
}
