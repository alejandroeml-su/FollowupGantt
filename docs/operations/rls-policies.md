# Row Level Security · estrategia y operación

Cobertura de Postgres RLS para las 56 tablas de FollowupGantt en Supabase
prod. Pieza de defensa en profundidad: la app valida sesión y permisos
en Node antes de querir, RLS protege contra cualquier conexión directa
con la `anon` key o un rol `authenticated` (Supabase Auth, dashboards
embebidos, scripts ad-hoc).

## Estrategia

- **Bypass para el backend**. La conexión Prisma usa el rol `postgres`
  (o un rol con `BYPASSRLS`) — las server actions YA validan auth.
  RLS no debe bloquear queries legítimas del backend.

- **`auth.uid()` como referencia futura**. Las policies se escriben en
  el formato Supabase Auth (`auth.uid()::text = "userId"`). La app
  todavía usa sesión Prisma propia, pero los hooks SSO Google/Microsoft
  emiten ya `Session` rows compatibles. Cuando Edwin migre a Supabase
  Auth nativo, las policies entran en vigor automáticamente.

- **Patrones de policy** (resumen):

  | Tipo de tabla                                     | SELECT                                  | INSERT/UPDATE/DELETE                           |
  | ------------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
  | Catálogos globales (User, Role, Gerencia, …)      | autenticados                            | sólo SUPER_ADMIN/ADMIN                         |
  | Multi-tenant (Project, Task, Goal, …)             | manager / assignee / ProjectAssignment  | manager / admin / assignee según caso          |
  | Privadas por owner (Notification, ApiToken, …)    | `userId = auth.uid()`                   | `userId = auth.uid()`                          |
  | Auditoría (AuditEvent, TaskHistory)               | sólo ADMIN+                             | denied (backend escribe vía service_role)      |
  | Públicas (PublicForm.isActive, FormSubmission)    | `anon` SELECT (form activo)             | `anon` INSERT (form activo); resto admin       |

- **Helpers** (`app_security.is_admin()`, `has_project_access()`,
  `has_workspace_access()`, `has_task_access()`) viven en el schema
  `app_security` y son `STABLE` para que Postgres los cachee dentro de
  un statement.

## Aplicar la migración

La migración SQL es **idempotente**: ejecutar dos veces no falla
(`DROP POLICY IF EXISTS` antes de cada `CREATE POLICY`; `ALTER TABLE
... ENABLE ROW LEVEL SECURITY` no falla si ya está habilitado).

### Vía SQL Editor de Supabase (recomendado para prod)

1. Supabase Dashboard → `SQL Editor → + New query`.
2. Copiar el contenido de `prisma/migrations/20260504_rls_policies/migration.sql`.
3. Pegar y ejecutar (`Run` o `Cmd+Enter`).
4. Esperar a que termine — debería tardar < 5s.
5. Confirmar que no hubo errores en el panel "Results".

### Vía `psql` con `DIRECT_URL`

```bash
psql "$DIRECT_URL" -f prisma/migrations/20260504_rls_policies/migration.sql
```

> Usar `DIRECT_URL` (no `DATABASE_URL`) para evitar el pooler en
> sentencias DDL.

### Vía Prisma (NO recomendado)

`prisma migrate deploy` la aplicará automáticamente, pero como es DDL
crítico Edwin prefiere ejecutarla manualmente para revisar el resultado
antes de marcarla como aplicada.

## Verificación

### 1. Confirmar que RLS está habilitado en cada tabla

```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false
ORDER BY tablename;
```

Resultado esperado: **0 filas** (todas las tablas con RLS).

### 2. Contar policies registradas

```sql
SELECT count(*) AS total_policies FROM pg_policies WHERE schemaname = 'public';
```

Resultado esperado: ≥ 60 (entre 60 y 75 según se ajusten policies adicionales).

### 3. Listar policies por tabla

```sql
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### 4. Diff con `supabase db diff`

Si el proyecto está vinculado al CLI de Supabase:

```bash
supabase db diff --linked --schema public --schema app_security
```

No debería mostrar diferencias relevantes tras aplicar la migración
(sólo las que hayan introducido migraciones Prisma intermedias).

### 5. Smoke test funcional

```sql
-- Simular un user authenticated (Supabase test):
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"<user-uuid>"}';
SELECT id, name FROM "Project";  -- solo los del user
RESET ROLE;
```

## Service role y backend Prisma

El backend debe seguir usando un rol con `BYPASSRLS`. Comprobación:

```sql
SELECT rolname, rolbypassrls, rolsuper
FROM pg_roles
WHERE rolname IN ('postgres', 'service_role', 'authenticator');
```

- `postgres` ⇒ bypass por ser superuser.
- `service_role` ⇒ debe tener `rolbypassrls = true`.
- `authenticator` ⇒ NO debe bypassrls (es el rol PostgREST runtime).

`DATABASE_URL` debe apuntar a `postgres` o `service_role`. La anon key
y el rol `authenticated` quedan SIEMPRE sujetos a RLS.

## Troubleshooting

### `permission denied for relation X`

Causa típica: el rol está sujeto a RLS y ninguna policy le da acceso.
Diagnóstico paso a paso:

1. Confirmar el rol activo: `SELECT current_user, current_setting('role');`.
2. Si es `authenticated`/`anon`, revisar `pg_policies` para esa tabla:

   ```sql
   SELECT policyname, cmd, qual, with_check
   FROM pg_policies
   WHERE tablename = 'Task';
   ```

3. Confirmar que `auth.uid()` devuelve el UUID esperado:

   ```sql
   SELECT auth.uid();
   ```

4. Si `auth.uid()` es `NULL`, el JWT no se está pasando — revisar el
   header `Authorization: Bearer <jwt>` en la query directa.

### Backend (Prisma) recibe `permission denied`

Significa que el rol del backend NO bypassa RLS. Acciones:

1. Verificar `pg_roles` (sección anterior).
2. Si es necesario, conceder bypass al rol que usa Prisma:

   ```sql
   ALTER ROLE service_role BYPASSRLS;
   ```

3. Reiniciar el pool del backend (Vercel: redeploy) para forzar reconexión.

### Una policy es demasiado permisiva o restrictiva

1. Editar el SQL en `migration.sql` (mantener idempotencia: `DROP POLICY
   IF EXISTS` + `CREATE POLICY`).
2. Crear una nueva migración follow-up (`prisma/migrations/20260YYY_rls_<fix>/migration.sql`)
   en lugar de editar la existente para preservar el historial.
3. Aplicar y verificar.

### Tablas nuevas (al añadir un model en Prisma)

Cada vez que se haga `prisma migrate` con una tabla nueva, crear
migración follow-up `20260YYY_rls_<modelo>/migration.sql` con
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` antes
de exponerla. Añadir el ALTER al checklist de PR review (regla SRE).

## Referencias

- [Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [PostgreSQL RLS docs](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)
- [`migration.sql`](../../prisma/migrations/20260504_rls_policies/migration.sql)
- [setup-checklist.md](./setup-checklist.md)
