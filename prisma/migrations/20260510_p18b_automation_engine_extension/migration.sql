-- Wave P18-B (Automation rule engine extension) — agrega valor AUTOMATION
-- al enum NotificationType para que las acciones `notify` puedan crear
-- notificaciones in-app sin colisionar con los kinds existentes.
--
-- Aditiva. Sin destrucciones. Idempotente vía guard DO $$.
--
-- IMPORTANTE: ALTER TYPE ... ADD VALUE NO se puede ejecutar dentro de un
-- bloque transaccional. Postgres lanzaría:
--   "ALTER TYPE ... ADD cannot run inside a transaction block".
-- Por eso usamos `DO $$` que escape de la transacción de Prisma migrate
-- vía SECURITY DEFINER no es necesario aquí; lo aplicamos directo.
-- Si el migrate corre dentro de una tx, ejecutar manualmente via
-- Supabase MCP execute_sql con el bloque DO.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'NotificationType' AND e.enumlabel = 'AUTOMATION'
  ) THEN
    -- ALTER TYPE en este bloque DO funciona porque el bloque PL/pgSQL
    -- gestiona su propia subtransacción. En Postgres ≥ 12 es seguro.
    EXECUTE 'ALTER TYPE "NotificationType" ADD VALUE ''AUTOMATION''';
  END IF;
END$$;
