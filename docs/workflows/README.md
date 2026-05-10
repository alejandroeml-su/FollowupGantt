# GitHub Workflows · setup manual

Este directorio contiene **plantillas de workflows que requieren scope OAuth `workflow`** para ser creadas. Por seguridad, Claude Code (vía gh CLI sin ese scope) no puede pushear directamente a `.github/workflows/`. El owner del repositorio debe copiarlos manualmente.

## migrate-deploy.yml

Aplica `prisma migrate deploy` a Supabase prod automáticamente cuando se mergea un PR con cambios en `prisma/migrations/**` o `prisma/schema.prisma`.

### Setup

1. Copiar el contenido de `migrate-deploy.yml.template` a `.github/workflows/migrate-deploy.yml`:
   ```bash
   mkdir -p .github/workflows
   cp docs/workflows/migrate-deploy.yml.template .github/workflows/migrate-deploy.yml
   git add .github/workflows/migrate-deploy.yml
   git commit -m "ops(ci): activar workflow Prisma Migrate Deploy"
   git push
   ```

2. Configurar el secret en GitHub:
   - Settings → Secrets and variables → Actions → New repository secret
   - Name: `DATABASE_URL`
   - Value: cadena de conexión PostgreSQL de Supabase (recomendado: pool 6543).

3. Probar primer run:
   - Actions → Prisma Migrate Deploy → Run workflow → master.

### Override

Para mergear un PR con migrations sin que el workflow corra (ej. migration ya aplicada manualmente vía MCP), incluir `[skip migrate]` en el commit message.
