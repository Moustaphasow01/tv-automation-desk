import { createAgentRuntimeAdminService } from "./agent-runtime-admin-service.js";
import { createAgentRuntimeSchedulerService } from "./agent-runtime-scheduler-service.js";

export function attachAgentRuntimeStoreMethods(StoreClass) {
  Object.assign(StoreClass.prototype, agentRuntimeStoreMethods);
}

const agentRuntimeStoreMethods = {
  async getAgentRuntimeOverview(args = {}) {
    return adminService(this).getOverview(args);
  },

  async listAgentRuntimeTasks(args = {}) {
    return adminService(this).listTasks(args);
  },

  async getAgentRuntimePoolOverview(args = {}) {
    return adminService(this).getPoolOverview(args);
  },

  async getAgentRuntimeSchedulerPlan(args = {}) {
    return schedulerService(this).previewSchedule(args);
  },

  async listAgentRuntimeMetrics(args = {}) {
    return adminService(this).listMetrics(args);
  },

  async listAgentRuntimeDeadLetters(args = {}) {
    return adminService(this).listDeadLetters(args);
  },
};

function adminService(store) {
  if (!store.agentRuntimeAdmin) {
    store.agentRuntimeAdmin = createAgentRuntimeAdminService({ persistence: store.persistence, clock: store.clock });
  }
  return store.agentRuntimeAdmin;
}

function schedulerService(store) {
  if (!store.agentRuntimeScheduler) {
    store.agentRuntimeScheduler = createAgentRuntimeSchedulerService({ persistence: store.persistence, clock: store.clock });
  }
  return store.agentRuntimeScheduler;
}
