import { z } from "zod";
import { registerOosTool } from "./oos-mcp-tool.js";

const id = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const kind = z.enum(["scenario_audit", "plan_audit", "finding", "family", "hypothesis", "critique", "experiment", "failure_pattern", "winner_pattern"]);

export function registerResearchTools({ server, auth, research }) {
  const read = (name, input, run) => registerOosTool(server, auth, { name, input, run, mode: "read",
    description: "Read research memory only. Interpretations are not ENGINE facts; missing evidence stays unknown. No trading command." });
  const write = (name, input, run) => registerOosTool(server, auth, { name, input, run, mode: "write",
    description: "Write isolated T3 research memory only. May run bounded paid model inference if configured. No plan, replay, broker, champion mutation or promotion." });
  write("start_research_cycle", z.object({ dates: z.array(date).min(1).max(1000),
    budget: z.object({ maximum_model_calls: z.number().int().min(0).max(10000) }).strict() }).strict(), args => research.start(args));
  write("advance_research_cycle", z.object({ cycle_id: id, maximum_cases: z.number().int().min(1).max(20).optional() }).strict(), args => research.advance(args));
  read("get_research_status", z.object({ cycle_id: id }).strict(), args => research.status(args));
  read("get_research_artifacts", z.object({ cycle_id: id, kind, limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().max(4000).optional() }).strict(), args => research.artifacts(args));
  read("get_research_scorecard", z.object({ cycle_id: id, rule: z.object({ feature: z.string().min(1).max(100),
    operator: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]), value: z.union([z.number().finite(), z.string().max(100)]) }).strict().optional() }).strict(), args => research.scorecard(args));
  write("register_research_experiment", z.object({ cycle_id: id, hypothesis_id: id, protocol: z.object({
    split: z.object({ discovery: z.array(date).min(1), validation: z.array(date).min(1), test: z.array(date).min(1) }).strict(),
    primary_metric: z.string().min(1).max(200), stopping_rule: z.string().min(1).max(2000),
    false_discovery_control: z.string().min(1).max(2000) }).strict() }).strict(), args => research.experiment(args));
}
