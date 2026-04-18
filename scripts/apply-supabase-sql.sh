#!/usr/bin/env bash

set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql not found. Please install PostgreSQL client tools first."
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Error: DATABASE_URL is not set."
  echo "Usage: DATABASE_URL='postgresql://user:pass@host:5432/dbname' bash scripts/apply-supabase-sql.sh"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS=(
  "$ROOT_DIR/supabase/migrations/20260417_init_diagrams.sql"
  "$ROOT_DIR/supabase/migrations/20260418_align_diagram_schema.sql"
  "$ROOT_DIR/supabase/migrations/20260418_add_physical_field_columns.sql"
  "$ROOT_DIR/supabase/migrations/20260418_diagram_share_links.sql"
  "$ROOT_DIR/supabase/migrations/20260418_rls_policies.sql"
)

echo "Applying Supabase SQL migrations in fixed order..."
for file in "${MIGRATIONS[@]}"; do
  echo "-> $file"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
done

echo "Done."
