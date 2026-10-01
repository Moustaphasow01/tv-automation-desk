import { requireFact } from "../domain/batch-contract.js";
import { describeSmc3Records, SMC3_ENUMS } from "../domain/smc3-record-contract.js";
import { smc3ContractExamples } from "../domain/smc3-contract-examples.js";
import { validateSmc3Syntax } from "../domain/smc3-syntax.js";

const displayInputs = new Set(["COLLER LE PLAN COMPACT ICI", "Vue", "Texte", "Largeur du tableau (%)",
  "Page (TOUTES / JOURNAL / POSITIONS)", "Lignes visibles (pas limite du moteur)",
  "Epingler les transitions recentes (15m)", "Tickets sur le graphique de prix"]);

export function ruleInputFingerprint({ installed, fingerprint }) {
  const inputs = installed.values.filter(input => !displayInputs.has(installed.inputs.find(info => info.id === input.id)?.name));
  return fingerprint(JSON.stringify({ version: "V3.9.8", digest: installed.pine.digest, inputs }));
}

export function buildSmc3Contract({ syntax, facts, provenance, fingerprint, encodeJson }) {
  const records = describeSmc3Records(), valid_examples = smc3ContractExamples();
  for (const example of valid_examples) {
    validateSmc3Syntax({ ...example, engine_version: "V3.9.8", schema: "SMC3", plan_sha256: fingerprint(example.plan_text) });
    records[example.record_type].example = example.record_text;
  }
  const contract = { schema: "SMC3", contract_version: "desk-oos-smc3-contract/1", parser_version: "smc3-v3.9.8-syntax/1",
    engine_version: "V3.9.8", encoding: "UTF-8, well-formed Unicode, original bytes are never rewritten", provenance,
    separators: { record: ";", field: "|", quoting: false, escaping: false, newlines: "whitespace only, not record separators",
      surrounding_whitespace: "trimmed for validation only", empty_records: "ignored", trailing_semicolon: "optional" },
    absence: { blank_numeric: ["", "-"], nd: "N/D is display-only, never valid in a numeric input",
      literal_dash_required: "Several entry/stop/condition geometry fields require literal -, not empty text; see record rules" },
    numeric: { pattern: "^-?[0-9]+(\\.[0-9]+)?$", absolute_maximum: 1000000000000,
      scientific_notation: false, decimal_separator: ".", price_tick: 0.25 },
    maximum_plan_size: { characters: facts.max_text, backend_measure: "JavaScript UTF-16 code units, not UTF-8 bytes",
      mcp_input_characters: 2000000, effective_limit: facts.max_text, overflow: "PLAN_ENGINE_TEXT_CAPACITY; no truncation" },
    records, enums: SMC3_ENUMS, validation_rules: Object.entries(records).flatMap(([record, spec]) =>
      spec.rules.map(rule => ({ record, rule }))),
    condition_semantics: "Execution semantics are in get_engine_constraints; this contract only specifies accepted syntax",
    compatibility: { backend_schema: "SMC3", native_engine_other_schemas_not_exposed: ["SMC1", "SMC2"],
      native_engine_date_years: [2000, 2100], backend_date_check: "Valid civil date; native ENGINE additionally requires 2000..2100",
      v1_tool_date_range: ["2026-07-01", "2026-08-31"], supported_symbol: "CME_MINI:MES1!",
      HALT: "Not supported for SMC3; NOTICE does not halt",
      unknown_record: "Rejected, never ignored", scenario_limit: "No business quota; text/native resource capacities only" },
    validation_errors: [...new Set(syntax.flatMap(item => [...item.text.matchAll(/"(PLAN_[A-Z0-9_]+)"/g)].map(match => match[1])))].sort(),
    validation_failure: "First explicit error; whole document rejected; no repair, partial import, scoring or RR filter",
    original_storage: "Exact received text is SHA-256 hashed and frozen; whitespace used for validation does not alter stored bytes",
    valid_examples, hash_format: "SHA-256 of UTF-8 JSON.stringify(document_without_own_hash,null,2) followed by LF" };
  return { ...contract, contract_sha256: fingerprint(encodeJson(contract)) };
}

/** Query-only view: no archive, DB, command queue, capture or execution dependency. */
export class OosRuntimeContracts {
  constructor({ engine, smc3, installed, readInstalled, fingerprint }) {
    Object.assign(this, { engine, smc3, installed, readInstalled, fingerprint });
  }
  async verify() {
    requireFact(typeof this.readInstalled === "function", "ENGINE_RUNTIME_UNVERIFIED");
    const actual = await this.readInstalled();
    requireFact(actual.name === this.installed.name && actual.pine?.version === this.installed.pine.version
      && ruleInputFingerprint({ installed: actual, fingerprint: this.fingerprint }) === this.engine.provenance.config_sha256,
    "CONTRACT_DRIFT");
    return true;
  }
  async engineConstraints() { await this.verify(); return structuredClone(this.engine); }
  async smc3Contract() { await this.verify(); return structuredClone(this.smc3); }
  async runtimeContract() {
    await this.verify();
    return structuredClone({ engine_constraints: this.engine, smc3_contract: this.smc3,
      engine_constraints_sha256: this.engine.engine_constraints_sha256, smc3_contract_sha256: this.smc3.contract_sha256,
      engine_version: this.engine.engine_version, schema: this.smc3.schema, book_mode: this.engine.book_mode,
      drift_policy: "Pin both hashes before batch; any change or CONTRACT_DRIFT requires HALT, never auto-accept a new version" });
  }
}
