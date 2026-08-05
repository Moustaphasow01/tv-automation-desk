import { z } from "zod";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "./strategy-runtime-versioning.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nativeDocumentSchema(contractName, contractVersion, requiredNativeKey) {
  return z.record(z.any()).superRefine((value, ctx) => {
    if (!isPlainObject(value.contract)
      || value.contract.name !== contractName
      || value.contract.version !== contractVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contract"],
        message: `NATIVE_CONTRACT_DISCRIMINATOR_REQUIRED:${contractName}@${contractVersion}`,
      });
    }
    if (requiredNativeKey && !isPlainObject(value[requiredNativeKey])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [requiredNativeKey],
        message: `NATIVE_SOURCE_KEY_REQUIRED:${requiredNativeKey}`,
      });
    }
  });
}

// The normative JSON Schemas are validated once at the save boundary. These
// transport schemas only enforce the versioned envelope and preserve the full
// GPT source document byte-for-byte at the object/key level.
export const masterAnalysisV5SourceSchema = nativeDocumentSchema(
  "DeskMasterAnalysisContract",
  ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract,
  "execution_plan",
);

export const hourlyMonitorV2SourceSchema = nativeDocumentSchema(
  "DeskHourlyThesisMonitorContract",
  ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
  "command",
);
