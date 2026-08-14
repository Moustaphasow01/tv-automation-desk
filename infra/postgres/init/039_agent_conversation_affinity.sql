CREATE UNIQUE INDEX IF NOT EXISTS agent_conversations_one_open_affinity_idx
  ON agent_conversations (agent_mission_id, provider, affinity_key)
  WHERE status = 'OPEN' AND affinity_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_conversations_open_affinity_lookup_idx
  ON agent_conversations (
    agent_mission_id,
    provider,
    affinity_key,
    status,
    turn_count,
    last_used_at_utc DESC NULLS LAST
  )
  WHERE status = 'OPEN';
