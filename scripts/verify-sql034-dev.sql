-- SQL034 - Verificacion de SOLO LECTURA antes de desplegar el backend.
--
-- Comprueba que la base de datos (por ejemplo, la DEV del VPS) tiene aplicados
-- los dos changesets de SQL034 con sus tablas, restricciones, RLS, politicas,
-- trigger y permisos, y que el LOGIN que usa el backend (DATABASE_URL) es
-- seguro (sin superusuario ni BYPASSRLS, miembro de smarthome_runtime_app).
--
-- NO modifica nada: corre dentro de una transaccion READ ONLY que se revierte.
-- NO lee datos de negocio: solo el catalogo de PostgreSQL y databasechangelog.
--
-- Uso (ejecutar con un usuario que pueda leer public.databasechangelog,
-- por ejemplo el owner/migrador; NUNCA aplica cambios):
--   psql -X -d smarthome -U <usuario> -v app_login=smarthome_app_login -f scripts/verify-sql034-dev.sql
-- Dentro del contenedor de PostgreSQL del VPS:
--   docker exec -i <contenedor_postgres> psql -X -U <usuario> -d smarthome -v app_login=smarthome_app_login < scripts/verify-sql034-dev.sql
--
-- app_login = rol LOGIN del DATABASE_URL del backend (por defecto smarthome_app_login).
-- Resultado: una fila por comprobacion (PASS/FAIL) y un veredicto final.

\if :{?app_login}
\else
\set app_login smarthome_app_login
\endif
\pset pager off

BEGIN TRANSACTION READ ONLY;

WITH sql034_checks AS (
WITH
  t AS (SELECT to_regclass('config.home_energy_tariff') AS oid),
  g AS (SELECT to_regclass('config.home_energy_goal') AS oid),
  lb AS (SELECT to_regclass('public.databasechangelog') AS oid),
  app AS (SELECT r.* FROM pg_roles r WHERE r.rolname = :'app_login'),
  rt AS (SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smarthome_runtime_app') AS ok)
SELECT * FROM (
  VALUES
  (1, 'Tabla public.databasechangelog de Liquibase existe',
      (SELECT oid IS NOT NULL FROM lb)),
  (2, 'Changeset smarthome-sql034-energy-tariff-budget-20261029 aplicado',
      CASE WHEN (SELECT oid FROM lb) IS NULL THEN false
           ELSE (xpath('/row/c/text()', query_to_xml(
             'SELECT count(*) AS c FROM public.databasechangelog WHERE id = ''smarthome-sql034-energy-tariff-budget-20261029''',
             false, true, '')))[1]::text::int = 1 END),
  (3, 'Changeset smarthome-sql034-energy-goal-optional-budget-20261029 aplicado',
      CASE WHEN (SELECT oid FROM lb) IS NULL THEN false
           ELSE (xpath('/row/c/text()', query_to_xml(
             'SELECT count(*) AS c FROM public.databasechangelog WHERE id = ''smarthome-sql034-energy-goal-optional-budget-20261029''',
             false, true, '')))[1]::text::int = 1 END),
  (4, 'Tabla config.home_energy_tariff existe',
      (SELECT oid IS NOT NULL FROM t)),
  (5, 'Tabla config.home_energy_goal existe',
      (SELECT oid IS NOT NULL FROM g)),
  (6, 'monthly_budget_cop acepta NULL (SQL034/002)',
      EXISTS (SELECT 1 FROM pg_attribute a, g
              WHERE a.attrelid = g.oid AND a.attname = 'monthly_budget_cop'
                AND NOT a.attnotnull AND NOT a.attisdropped)),
  (7, 'Restriccion ck_home_energy_goal_budget_or_target existe',
      EXISTS (SELECT 1 FROM pg_constraint c, g
              WHERE c.conrelid = g.oid AND c.conname = 'ck_home_energy_goal_budget_or_target')),
  (8, 'Unicidad uq_home_energy_tariff_effective y uq_home_energy_goal_month',
      (SELECT count(*) FROM pg_constraint
       WHERE conname IN ('uq_home_energy_tariff_effective', 'uq_home_energy_goal_month')
         AND contype = 'u') = 2),
  (9, 'RLS activa en ambas tablas',
      (SELECT count(*) FROM pg_class c
       WHERE c.oid IN ((SELECT oid FROM t), (SELECT oid FROM g)) AND c.relrowsecurity) = 2),
  (10, 'Politicas RLS: 2 en tarifas (select, insert) y 3 en metas (select, insert, update)',
      (SELECT count(*) FROM pg_policies WHERE schemaname = 'config' AND tablename = 'home_energy_tariff'
         AND policyname IN ('home_energy_tariff_select_policy', 'home_energy_tariff_insert_policy')) = 2
      AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'config' AND tablename = 'home_energy_goal'
         AND policyname IN ('home_energy_goal_select_policy', 'home_energy_goal_insert_policy',
                            'home_energy_goal_update_policy')) = 3),
  (11, 'Trigger trg_home_energy_goal_updated_at existe',
      EXISTS (SELECT 1 FROM pg_trigger tr, g
              WHERE tr.tgrelid = g.oid AND tr.tgname = 'trg_home_energy_goal_updated_at' AND NOT tr.tgisinternal)),
  (12, 'Rol smarthome_runtime_app existe',
      (SELECT ok FROM rt)),
  (13, 'runtime_app: SELECT e INSERT en tarifas; sin UPDATE ni DELETE (historico inmutable)',
      CASE WHEN (SELECT oid FROM t) IS NULL OR NOT (SELECT ok FROM rt) THEN false ELSE
        has_table_privilege('smarthome_runtime_app', 'config.home_energy_tariff', 'SELECT')
        AND has_table_privilege('smarthome_runtime_app', 'config.home_energy_tariff', 'INSERT')
        AND NOT has_table_privilege('smarthome_runtime_app', 'config.home_energy_tariff', 'UPDATE')
        AND NOT has_table_privilege('smarthome_runtime_app', 'config.home_energy_tariff', 'DELETE') END),
  (14, 'runtime_app: SELECT/INSERT en metas, UPDATE solo de presupuesto y meta, sin DELETE',
      CASE WHEN (SELECT oid FROM g) IS NULL OR NOT (SELECT ok FROM rt) THEN false ELSE
        has_table_privilege('smarthome_runtime_app', 'config.home_energy_goal', 'SELECT')
        AND has_table_privilege('smarthome_runtime_app', 'config.home_energy_goal', 'INSERT')
        AND has_column_privilege('smarthome_runtime_app', 'config.home_energy_goal', 'monthly_budget_cop', 'UPDATE')
        AND has_column_privilege('smarthome_runtime_app', 'config.home_energy_goal', 'target_kwh', 'UPDATE')
        AND NOT has_column_privilege('smarthome_runtime_app', 'config.home_energy_goal', 'month_start', 'UPDATE')
        AND NOT has_column_privilege('smarthome_runtime_app', 'config.home_energy_goal', 'id_home', 'UPDATE')
        AND NOT has_table_privilege('smarthome_runtime_app', 'config.home_energy_goal', 'DELETE') END),
  (15, 'Funciones consumption.fn_can_read_detail y homes.fn_can_manage_home existen',
      to_regprocedure('consumption.fn_can_read_detail(uuid)') IS NOT NULL
      AND to_regprocedure('homes.fn_can_manage_home(uuid)') IS NOT NULL),
  (16, 'LOGIN del backend (' || :'app_login' || ') existe y puede iniciar sesion',
      EXISTS (SELECT 1 FROM app WHERE rolcanlogin)),
  (17, 'LOGIN del backend sin superusuario ni BYPASSRLS',
      EXISTS (SELECT 1 FROM app WHERE NOT rolsuper AND NOT rolbypassrls)),
  (18, 'LOGIN del backend es miembro de smarthome_runtime_app',
      CASE WHEN NOT EXISTS (SELECT 1 FROM app) OR NOT (SELECT ok FROM rt) THEN false
           ELSE pg_has_role(:'app_login', 'smarthome_runtime_app', 'MEMBER') END),
  (19, 'LOGIN del backend no es dueno de las tablas de SQL034',
      EXISTS (SELECT 1 FROM app) AND NOT EXISTS (
        SELECT 1 FROM pg_class c
        WHERE c.oid IN ((SELECT oid FROM t), (SELECT oid FROM g))
          AND pg_has_role(:'app_login', c.relowner, 'MEMBER')))
) AS checks(n, comprobacion, ok)
),
results AS (
  SELECT n, comprobacion, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS resultado
  FROM sql034_checks
  UNION ALL
  SELECT 99,
         CASE WHEN bool_and(ok)
              THEN 'VEREDICTO: la base tiene SQL034 y el LOGIN del backend es seguro. Se puede desplegar el backend.'
              ELSE 'VEREDICTO: hay ' || count(*) FILTER (WHERE NOT ok) || ' comprobacion(es) en FAIL. Coordinar con la responsable de la base de datos.'
         END,
         CASE WHEN bool_and(ok) THEN 'LISTO' ELSE 'NO DESPLEGAR' END
  FROM sql034_checks
)
SELECT n AS "#", comprobacion AS "Comprobacion", resultado AS "Resultado"
FROM results ORDER BY n;

ROLLBACK;
