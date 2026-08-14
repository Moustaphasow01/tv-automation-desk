import { PostgresDomainAssistantRuntimeRepository } from "./domain-assistant-runtime-postgres-repository.js";
import { InMemoryDomainAssistantRuntimeRepository } from "./domain-assistant-runtime-memory-repository.js";

export function createDomainAssistantRuntimeRepository(persistence) {
  return persistence?.pool
    ? new PostgresDomainAssistantRuntimeRepository(persistence)
    : new InMemoryDomainAssistantRuntimeRepository();
}

export { PostgresDomainAssistantRuntimeRepository } from "./domain-assistant-runtime-postgres-repository.js";
export { InMemoryDomainAssistantRuntimeRepository } from "./domain-assistant-runtime-memory-repository.js";
