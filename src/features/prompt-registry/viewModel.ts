import type { PromptRegistryOverview } from "@/operationsTypes";

export type PromptRegistryViewModel = ReturnType<typeof buildPromptRegistryViewModel>;

export function buildPromptRegistryViewModel(data?: PromptRegistryOverview | null) {
  const summary = data?.summary || emptySummary();
  const prompts = (data?.items || []).map((item) => ({
    ...item,
    label: item.lane === "live" ? "Worker LIVE" : item.lane === "replay" ? "Worker REPLAY" : item.promptKey,
    hashShort: shortHash(item.renderedSha256),
    sourceShort: shortPath(item.sourcePath),
    consumerCount: item.consumers.length,
    contractCount: item.contracts.length,
  }));
  return {
    generatedAt: data?.generatedAt || "—",
    metrics: [
      { label: "Prompts actifs", value: summary.activePrompts, detail: `${summary.activeBindings} binding(s)` },
      { label: "Compositions", value: summary.publishedCompositions, detail: "publiées" },
      { label: "Parité OK", value: summary.parityOk, detail: `${summary.parityDrift} drift` },
      { label: "À remplacer", value: summary.dynamicPromptsToReplace, detail: "execution_prompt dynamiques" },
    ],
    prompts,
    dynamicPrompts: data?.dynamicPrompts || [],
    source: data?.source || null,
    hasDrift: summary.parityDrift > 0,
  };
}

function emptySummary() {
  return {
    activePrompts: 0,
    publishedCompositions: 0,
    activeBindings: 0,
    parityOk: 0,
    parityDrift: 0,
    dynamicPromptsToReplace: 0,
  };
}

function shortHash(value?: string | null) {
  return value ? value.replace(/^sha256:/, "").slice(0, 12) : "—";
}

function shortPath(value?: string | null) {
  return value ? value.split("/").slice(-2).join("/") : "—";
}
