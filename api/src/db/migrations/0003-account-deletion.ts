import type {Migration} from './types'

export const accountDeletionMigration: Migration = {
  version: 3,
  name: 'account_deletion',
  sql: `
ALTER TABLE rights_declarations ALTER COLUMN affirmed_by_user_id DROP NOT NULL;
ALTER TABLE rights_declarations DROP CONSTRAINT rights_declarations_affirmed_by_user_id_fkey;
ALTER TABLE rights_declarations ADD CONSTRAINT rights_declarations_affirmed_by_user_id_fkey
  FOREIGN KEY (affirmed_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE isrc_assignments ALTER COLUMN assigned_by_user_id DROP NOT NULL;
ALTER TABLE isrc_assignments DROP CONSTRAINT isrc_assignments_assigned_by_user_id_fkey;
ALTER TABLE isrc_assignments ADD CONSTRAINT isrc_assignments_assigned_by_user_id_fkey
  FOREIGN KEY (assigned_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE revenue_split_sets ALTER COLUMN created_by_user_id DROP NOT NULL;
ALTER TABLE revenue_split_sets DROP CONSTRAINT revenue_split_sets_created_by_user_id_fkey;
ALTER TABLE revenue_split_sets ADD CONSTRAINT revenue_split_sets_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE marketplace_audit_events ADD COLUMN anonymized_at TIMESTAMPTZ;
ALTER TABLE marketplace_audit_events DROP CONSTRAINT marketplace_audit_events_provider_profile_id_fkey;
ALTER TABLE marketplace_audit_events ADD CONSTRAINT marketplace_audit_events_provider_profile_id_fkey
  FOREIGN KEY (provider_profile_id) REFERENCES provider_profiles(id) ON DELETE SET NULL;

DROP TRIGGER marketplace_audit_events_append_only ON marketplace_audit_events;
DROP FUNCTION prevent_marketplace_audit_mutation();

CREATE FUNCTION prevent_marketplace_audit_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.anonymized_at IS NULL
    AND NEW.anonymized_at IS NOT NULL
    AND NEW.id = OLD.id
    AND NEW.entity_type = OLD.entity_type
    AND NEW.entity_id = OLD.entity_id
    AND NEW.action = OLD.action
    AND NEW.occurred_at = OLD.occurred_at
    AND (NEW.provider_profile_id IS NOT DISTINCT FROM OLD.provider_profile_id OR NEW.provider_profile_id IS NULL)
    AND (NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id OR NEW.actor_user_id IS NULL)
    AND NEW.before_data IS NULL
    AND NEW.after_data IS NULL
    AND NEW.metadata = '{}'::jsonb
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'marketplace audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER marketplace_audit_events_append_only
BEFORE UPDATE OR DELETE ON marketplace_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_marketplace_audit_mutation();
`,
}