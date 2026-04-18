# ER Tool Setup / Ops

## 1) Package Manager 安裝與啟動指令

### A. 使用 `pnpm`（推薦）

```bash
# 安裝 pnpm（macOS）
brew install pnpm

# 安裝依賴
pnpm install

# 開發模式
pnpm dev

# 打包
pnpm build

# 預覽 production build
pnpm preview
```

### B. 使用 `npm`

```bash
# 安裝 Node.js（含 npm）
brew install node

# 安裝依賴
npm install

# 開發模式
npm run dev

# 打包
npm run build

# 預覽 production build
npm run preview
```

## 2) Supabase SQL 一鍵套用順序

固定順序如下（不可跳號）：

1. `supabase/migrations/20260417_init_diagrams.sql`
2. `supabase/migrations/20260418_align_diagram_schema.sql`
3. `supabase/migrations/20260418_add_physical_field_columns.sql`
4. `supabase/migrations/20260418_diagram_share_links.sql`
5. `supabase/migrations/20260418_rls_policies.sql`
6. `supabase/migrations/20260418_share_token_rls.sql`

### 一鍵套用（直接對 DB 跑 SQL）

```bash
DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/postgres' \
bash scripts/apply-supabase-sql.sh
```

### 用 Supabase CLI（若已連線專案）

```bash
# 本地重建 + 套 migration（local）
supabase db reset

# 推送到雲端專案（remote）
supabase db push
```
