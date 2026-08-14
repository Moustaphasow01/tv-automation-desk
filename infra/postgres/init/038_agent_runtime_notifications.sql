CREATE OR REPLACE FUNCTION notify_agent_runtime_work_ready()
RETURNS trigger AS $$
DECLARE
  payload json;
BEGIN
  IF NEW.status IN ('PENDING', 'READY')
    AND (
      TG_OP = 'INSERT'
      OR OLD.status IS DISTINCT FROM NEW.status
      OR OLD.not_before_utc IS DISTINCT FROM NEW.not_before_utc
      OR OLD.lane IS DISTINCT FROM NEW.lane
    ) THEN
    SELECT json_build_object(
      'schema', 'desk_agent_runtime_ready_v1',
      'lane', NEW.lane,
      'task_id', NEW.agent_task_id,
      'mission_id', NEW.agent_mission_id,
      'status', NEW.status,
      'not_before_utc', NEW.not_before_utc,
      'correlation_id', NEW.correlation_id
    ) INTO payload;
    PERFORM pg_notify('desk_agent_runtime_ready', payload::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_tasks_notify_ready_trg ON agent_tasks;
CREATE TRIGGER agent_tasks_notify_ready_trg
  AFTER INSERT OR UPDATE OF status, not_before_utc, lane ON agent_tasks
  FOR EACH ROW EXECUTE FUNCTION notify_agent_runtime_work_ready();
