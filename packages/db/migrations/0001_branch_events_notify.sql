-- branch_events INSERT → NOTIFY 'branch_events' (payload: {"branch_id","seq","tenant_id"}).
-- NOTIFY transaction COMMIT anında iletilir; API süreçleri LISTEN ile SSE'ye dağıtır (14 §1, §7.1).
CREATE OR REPLACE FUNCTION notify_branch_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(
    'branch_events',
    json_build_object('branch_id', NEW.branch_id, 'seq', NEW.seq, 'tenant_id', NEW.tenant_id)::text
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS branch_events_notify ON branch_events;
--> statement-breakpoint
CREATE TRIGGER branch_events_notify
  AFTER INSERT ON branch_events
  FOR EACH ROW EXECUTE FUNCTION notify_branch_event();
