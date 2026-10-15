import type { Pool } from 'pg';
import { MqttRevocationDatabaseUnsafeError } from '../../application/services/mqtt-revocation.loop';

// Kept identical to the coordinated database repository's read-only audit.
export const MQTT_REVOCATION_DATABASE_AUDIT_SQL = `
-- HU11 read-only audit. Run with the actual revocation LOGIN, without SET ROLE.
WITH
runtime AS (
  SELECT pg_catalog.to_regrole('smarthome_mqtt_revoke') AS role_id,
         pg_catalog.to_regclass('devices.mqtt_identity') AS identity_id
),
business_schemas AS (
  SELECT oid, nspowner, nspname FROM pg_catalog.pg_namespace
  WHERE nspname IN ('auth','homes','devices','consumption','notifications','identity_audit','sync','config')
),
functions AS (
  SELECT signature, allowed, pg_catalog.to_regprocedure(signature) AS oid
  FROM (VALUES
    ('devices.fn_claim_mqtt_revocation()', true),
    ('devices.fn_finish_mqtt_revocation(uuid,uuid,text)', true),
    ('devices.fn_register_mqtt_identity(uuid,uuid,text)', false),
    ('devices.fn_mqtt_identity_device_update()', false),
    ('devices.fn_capture_mqtt_identity_event()', false),
    ('devices.fn_mqtt_identity_event_append_only()', false)
  ) f(signature, allowed)
),
checks(check_name, passed) AS (
  SELECT 'exact_runtime_login', session_user = current_user
    AND COALESCE(pg_catalog.pg_has_role(session_user, role_id, 'USAGE'), false)
  FROM runtime
  UNION ALL
  SELECT 'nonprivileged_roles', NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r
    WHERE (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)
      AND (pg_catalog.pg_has_role(session_user, r.oid, 'MEMBER')
        OR pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER'))
  )
  UNION ALL
  SELECT 'isolated_membership', NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r
    WHERE r.rolname NOT IN (session_user, 'smarthome_mqtt_revoke')
      AND pg_catalog.pg_has_role(session_user, r.oid, 'MEMBER')
  )
  UNION ALL
  SELECT 'no_ownership', NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_database d WHERE d.datname = current_database()
      AND pg_catalog.pg_has_role(session_user, d.datdba, 'MEMBER')
  ) AND NOT EXISTS (
    SELECT 1 FROM business_schemas n WHERE pg_catalog.pg_has_role(session_user, n.nspowner, 'MEMBER')
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN business_schemas n ON n.oid = c.relnamespace
    WHERE pg_catalog.pg_has_role(session_user, c.relowner, 'MEMBER')
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN business_schemas n ON n.oid = p.pronamespace
    WHERE pg_catalog.pg_has_role(session_user, p.proowner, 'MEMBER')
  )
  UNION ALL
  SELECT 'registry_rls', COALESCE((
    SELECT c.relrowsecurity AND c.relkind = 'r' FROM pg_catalog.pg_class c WHERE c.oid = identity_id
  ), false) FROM runtime
  UNION ALL
  SELECT 'administrative_functions', COALESCE(bool_and(COALESCE(
    f.oid IS NOT NULL AND p.prosecdef
    AND 'search_path=pg_catalog, pg_temp' = ANY(p.proconfig)
    AND pg_catalog.has_function_privilege(current_user, f.oid, 'EXECUTE') = f.allowed
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
  , false)), false) FROM functions f LEFT JOIN pg_catalog.pg_proc p ON p.oid=f.oid
  UNION ALL
  SELECT 'no_direct_table_privileges', NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN business_schemas n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p','v','m','f')
      AND (pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_catalog.has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
  )
  UNION ALL
  SELECT 'identity_history_capture', COALESCE((
    SELECT h.relkind = 'r' AND h.relrowsecurity
      AND pg_catalog.current_setting('session_replication_role') = 'origin'
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = pg_catalog.to_regclass('devices.mqtt_identity')
          AND t.tgname = 'trg_mqtt_identity_event'
          AND t.tgfoid = pg_catalog.to_regprocedure('devices.fn_capture_mqtt_identity_event()')
          AND t.tgtype = 21 -- AFTER ROW INSERT OR UPDATE
          AND t.tgenabled = 'O' AND NOT t.tgisinternal
          AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgattr = ''::pg_catalog.int2vector)
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = h.oid AND t.tgname = 'trg_mqtt_identity_event_append_only'
          AND t.tgfoid = pg_catalog.to_regprocedure('devices.fn_mqtt_identity_event_append_only()')
          AND t.tgtype = 58 -- BEFORE STATEMENT UPDATE OR DELETE OR TRUNCATE
          AND t.tgenabled = 'O' AND NOT t.tgisinternal
          AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgattr = ''::pg_catalog.int2vector)
    FROM pg_catalog.pg_class h
    WHERE h.oid = pg_catalog.to_regclass('devices.mqtt_identity_event')
  ), false)
  UNION ALL
  SELECT 'no_schema_create', NOT EXISTS (
    SELECT 1 FROM business_schemas n WHERE pg_catalog.has_schema_privilege(current_user,n.oid,'CREATE')
  )
)
SELECT check_name, COALESCE(passed, false) AS passed FROM checks ORDER BY check_name;
`;

export async function assertMqttRevocationDatabase(pool: Pool): Promise<void> {
  const result = await pool.query<{ check_name: string; passed: boolean }>(
    MQTT_REVOCATION_DATABASE_AUDIT_SQL,
  );
  if (
    result.rows.length !== 9 ||
    result.rows.some((row) => row.passed !== true)
  ) {
    throw new MqttRevocationDatabaseUnsafeError();
  }
}
