DO $$
DECLARE k uuid := '9cea8aab-aa05-4e14-aa06-a89594166a27'; c uuid[];
BEGIN
  SELECT array_agg(id) INTO c FROM kit_cycles WHERE kit_id = k;
  SET LOCAL session_replication_role = replica;
  DELETE FROM kit_movement_items WHERE movement_id IN (SELECT id FROM kit_movements WHERE kit_id = k OR cycle_id = ANY(c));
  DELETE FROM kit_acceptance_items WHERE acceptance_id IN (SELECT id FROM kit_acceptances WHERE cycle_id = ANY(c));
  DELETE FROM kit_movements WHERE kit_id = k OR cycle_id = ANY(c);
  DELETE FROM kit_acceptances WHERE cycle_id = ANY(c);
  DELETE FROM kit_transfers WHERE cycle_id = ANY(c);
  DELETE FROM kit_composition_items WHERE composition_id IN (SELECT id FROM kit_compositions WHERE cycle_id = ANY(c));
  DELETE FROM kit_compositions WHERE cycle_id = ANY(c);
  DELETE FROM kit_balances WHERE cycle_id = ANY(c);
  DELETE FROM kit_events WHERE cycle_id = ANY(c);
  DELETE FROM kit_cycles WHERE kit_id = k;
  DELETE FROM kits WHERE id = k;
  SET LOCAL session_replication_role = origin;
END $$;