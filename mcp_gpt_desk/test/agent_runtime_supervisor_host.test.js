import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_RUNTIME_SUPERVISOR_HOST_PLATFORMS,
  buildAgentRuntimeSupervisorHeartbeatDetails,
  buildAgentRuntimeSupervisorHostConfig,
  normalizeHostPlatform,
  normalizeSchedulerMode,
} from "../src/agent-runtime-supervisor-host.js";

describe("Agent Runtime Supervisor host config", () => {
  it("builds a provider-neutral default without Windows assumptions", () => {
    const config = buildAgentRuntimeSupervisorHostConfig({
      env: {},
      argv: ["node", "run_agent_runtime_supervisor.mjs", "--once"],
      pid: 42,
      cwd: "/desk/app",
    });

    assert.equal(config.schema, "agent_runtime_supervisor_host_v1");
    assert.equal(config.once, true);
    assert.equal(config.host_platform, "node-process");
    assert.equal(config.worker_id, "agent-runtime-live-42");
    assert.equal(config.worker_pool, "live");
    assert.equal(config.project_root, "/desk/app");
    assert.equal(config.runner_configured, false);
  });

  it("accepts Windows systemd and container as host adapters but normalizes unknown values", () => {
    assert.deepEqual(AGENT_RUNTIME_SUPERVISOR_HOST_PLATFORMS, [
      "node-process",
      "windows-service",
      "systemd",
      "container",
    ]);
    assert.equal(normalizeHostPlatform("windows-service"), "windows-service");
    assert.equal(normalizeHostPlatform("systemd"), "systemd");
    assert.equal(normalizeHostPlatform("container"), "container");
    assert.equal(normalizeHostPlatform("kubernetes-cron"), "node-process");
  });

  it("parses pool policy, runner and scheduler configuration from env", () => {
    const config = buildAgentRuntimeSupervisorHostConfig({
      env: {
        DESK_AGENT_SUPERVISOR_HOST_PLATFORM: "systemd",
        DESK_AGENT_SUPERVISOR_LANE: "replay",
        DESK_AGENT_WORKER_POOL: "replay",
        DESK_AGENT_POOL_POLICY_JSON: "{\"pools\":{\"replay\":{\"max_concurrent_workers\":3}}}",
        DESK_AGENT_SUPERVISOR_RUNNER_COMMAND: "codex",
        DESK_AGENT_SUPERVISOR_RUNNER_ARGS: "run --json",
        DESK_AGENT_SCHEDULER_MODE: "enforce",
      },
      pid: 99,
      cwd: "/srv/desk",
    });

    assert.equal(config.host_platform, "systemd");
    assert.equal(config.worker_id, "agent-runtime-replay-99");
    assert.equal(config.runner_configured, true);
    assert.deepEqual(config.runner_args, ["run", "--json"]);
    assert.equal(config.scheduler_mode, "enforce");
    assert.equal(config.pool_policy_configured, true);
    assert.equal(config.pool_policy.pools.replay.max_concurrent_workers, 3);
  });

  it("renders heartbeat details without leaking env secrets", () => {
    const config = buildAgentRuntimeSupervisorHostConfig({
      env: {
        DESK_AGENT_SUPERVISOR_HOST_PLATFORM: "windows-service",
        DESK_AGENT_SUPERVISOR_ID: "agent-runtime-live-01",
        DESK_AGENT_SUPERVISOR_RUNNER_COMMAND: "codex",
      },
    });
    const details = buildAgentRuntimeSupervisorHeartbeatDetails(config, {
      runner_configured: true,
    });

    assert.equal(details.host_platform, "windows-service");
    assert.equal(details.worker_pool, "live");
    assert.equal(details.runner_configured, true);
    assert.equal("DESK_MCP_API_KEY" in details, false);
  });

  it("normalizes scheduler mode fail-closed to disabled", () => {
    assert.equal(normalizeSchedulerMode("shadow"), "shadow");
    assert.equal(normalizeSchedulerMode("enforce"), "enforce");
    assert.equal(normalizeSchedulerMode("surprise"), "disabled");
  });
});
