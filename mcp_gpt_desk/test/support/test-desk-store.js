import { SystemClock } from "@tv-automation/desk-time";
import { PersistentDeskStore } from "../../src/store.js";
import { InMemoryDeskPersistence } from "./in-memory-desk-persistence.js";

export function createTestDeskStore({ root = null, projectRoot = root, clock = new SystemClock(), documents = {} } = {}) {
  const persistence = new InMemoryDeskPersistence({
    documents,
    fixtureRoot: root,
    objectRoot: projectRoot || root || ".",
  });
  return {
    store: new PersistentDeskStore(clock, persistence),
    persistence,
  };
}
