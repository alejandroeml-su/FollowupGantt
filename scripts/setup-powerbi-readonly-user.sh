#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Wave R4-C · setup operativo para el rol `powerbi_readonly`.
#
# Este script NO se ejecuta como parte del pipeline CI/CD ni de las
# migraciones Prisma. Se corre UNA vez, manualmente, por el SRE que
# habilita la conexión Power BI → Supabase Postgres.
#
# Pre-requisitos:
#   1. La migración `20260511_r4c_bi_views_powerbi` ya está aplicada
#      (creó el schema `bi`, las 7 vistas y el rol `powerbi_readonly`
#      con NOLOGIN).
#   2. Tener acceso superuser a la DB Supabase. Idealmente usar
#      `psql "$DATABASE_URL_SUPERUSER"` con un connection string que
#      apunte al usuario `postgres` (no al pooler de Prisma).
#   3. Generador de passwords aleatorios disponible (openssl, pwgen,
#      Bitwarden CLI, etc.).
#
# Salidas:
#   - Password seteado al rol (mostrado UNA vez en STDOUT — copiar al
#     password manager corporativo).
#   - Verificación de grants (lista de vistas accesibles).
#
# Rotación: cada 90 días re-ejecutar este script — re-setea el password
# y rota el secreto. Documentar fecha en el password manager.
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

if [[ -z "${DATABASE_URL_SUPERUSER:-}" ]]; then
  echo "[CONFIG_MISSING] DATABASE_URL_SUPERUSER no está seteado." >&2
  echo "" >&2
  echo "Setear con:" >&2
  echo "  export DATABASE_URL_SUPERUSER='postgresql://postgres:<superuser-pwd>@db.<project>.supabase.co:5432/postgres'" >&2
  echo "" >&2
  echo "Obtener desde Supabase Dashboard → Project Settings → Database → Connection string (URI, role: postgres)." >&2
  exit 1
fi

# Generar password aleatorio (32 chars alfanuméricos). Si pwgen está
# disponible, lo usamos; si no, fallback a openssl rand.
if command -v pwgen >/dev/null 2>&1; then
  NEW_PASSWORD="$(pwgen -s 32 1)"
else
  NEW_PASSWORD="$(openssl rand -base64 24 | tr -d '+/=' | cut -c1-32)"
fi

echo "──────────────────────────────────────────────────────────────────────"
echo "Wave R4-C · Setup powerbi_readonly"
echo "──────────────────────────────────────────────────────────────────────"
echo ""
echo "Aplicando ALTER ROLE..."

# Ejecutar el ALTER ROLE en una transacción aislada. Comilla doble dentro
# de DO $$ para escapar el password (psql sustituye :'pwd' con quoting).
psql "$DATABASE_URL_SUPERUSER" <<EOF
\set new_pwd '${NEW_PASSWORD}'
ALTER ROLE "powerbi_readonly" LOGIN PASSWORD :'new_pwd';
EOF

echo ""
echo "Verificando grants (debe listar las 7 vistas bi.*):"
psql "$DATABASE_URL_SUPERUSER" -c "
  SELECT table_schema || '.' || table_name AS view, privilege_type
  FROM information_schema.role_table_grants
  WHERE grantee = 'powerbi_readonly'
    AND table_schema = 'bi'
  ORDER BY table_name;
"

echo ""
echo "──────────────────────────────────────────────────────────────────────"
echo "  Password seteado (cópialo AHORA al password manager corporativo):"
echo ""
echo "    powerbi_readonly  /  ${NEW_PASSWORD}"
echo ""
echo "  Connection string para Power BI Desktop / Service:"
echo ""
echo "    Server: db.<project>.supabase.co   (o pooler en port 6543)"
echo "    Port:   5432                       (direct) | 6543 (pooler)"
echo "    Database: postgres"
echo "    Username: powerbi_readonly"
echo "    Password: ${NEW_PASSWORD}"
echo "    SSL Mode: require"
echo ""
echo "  Próxima rotación: $(date -d '+90 days' '+%Y-%m-%d' 2>/dev/null || date -v+90d '+%Y-%m-%d' 2>/dev/null || echo '+90 días desde hoy')"
echo "──────────────────────────────────────────────────────────────────────"
