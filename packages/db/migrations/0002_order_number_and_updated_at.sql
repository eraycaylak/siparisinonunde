-- Sipariş numarası: tenants.order_seq kilitli artış (aynı transaction'da satır kilidi → sıralı, boşluksuz).
CREATE OR REPLACE FUNCTION next_order_number(p_tenant_id uuid) RETURNS integer
LANGUAGE sql AS $$
  UPDATE tenants SET order_seq = order_seq + 1 WHERE id = p_tenant_id RETURNING order_seq;
$$;
--> statement-breakpoint
-- updated_at: ham SQL güncellemelerinde de yenilensin (drizzle $onUpdate yalnız ORM yolunda çalışır).
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', r.table_name || '_set_updated_at', r.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      r.table_name || '_set_updated_at', r.table_name
    );
  END LOOP;
END;
$$;
