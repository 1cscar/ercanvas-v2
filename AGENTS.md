我是1cscsr，遇到網頁樣式需要用大白話跟我解釋
請永久遵守以下輸出規範：
1. 直接給結果，不要前言、不要總結。
2. 使用工具後只回報結果，不描述過程。
3. 除非我主動問，否則不解釋你在做什麼。
4. 程式碼保持完整，其他回覆保持簡短。
5. 我即使用中文提問，你也先以最省 token 的方式處理；僅在最終輸出用繁體中文。
# 專案資訊

## 專案名稱
- `er-diagram-tool`

## 專案定位
- 這是一個以 `React + Vite + TypeScript` 建置的資料庫圖表編輯工具。
- 核心目標是讓使用者建立、編輯與轉換三種圖表：
  - `ER 圖`
  - `邏輯圖`
  - `實體圖`
- 專案整合了 `Supabase` 做登入與資料儲存，也支援圖片匯入、AI 輔助正規化、匯出 PDF 等功能。

## 技術棧
- 前端：`React 18`、`TypeScript`、`Vite`
- 路由：`react-router-dom`
- 狀態管理：`zustand`
- 圖形編輯：`@xyflow/react`
- 拖曳互動：`@dnd-kit`
- 後端/資料：`@supabase/supabase-js`
- 匯出：`html2canvas`、`jspdf`
- 驗證：`zod`
- 測試：`Vitest`、`@testing-library/react`、`jsdom`
- 樣式：`Tailwind CSS`

## 啟動與測試
- 開發：`npm run dev`
- 建置：`npm run build`
- 預覽：`npm run preview`
- 測試：`npm run test`
- 監看測試：`npm run test:watch`

## 路由結構
- `/`：首頁，負責登入、圖表清單、建立/刪除/復原圖表
- `/diagram/er/:id`：ER 圖編輯頁
- `/diagram/logical/:id`：邏輯圖編輯頁
- `/diagram/physical/:id`：實體圖編輯頁
- `/shared/:token`：分享連結導向頁

## 核心功能

### 首頁
- 透過 `Supabase Auth` 進行登入。
- 支援 `Google OAuth`，也有 `email OTP` 備援。
- 顯示使用者圖表清單與刪除後的圖表。
- 可建立新的 `ER / 邏輯` 圖表。
- 支援回收桶與圖表復原。
- 有介面狀態記憶，例如光線模式、側欄折疊狀態等。

### ER 圖
- 使用 `React Flow` 編輯實體、屬性、關係節點與邊。
- 支援：
  - 新增/刪除節點與邊
  - 連線
  - Undo / Redo
  - Zoom / Fit view
  - 圖名編輯
  - 由 ER 轉換成邏輯圖
  - 圖片匯入
- 支援分享模式，當 `shareToken` 且權限為 `viewer` 或 `editor` 時會套用分享上下文。

### 邏輯圖
- 使用 `React Flow` 編輯資料表與欄位。
- 支援：
  - 欄位新增、刪除、排序、名稱修改
  - 欄位關聯邊
  - Undo / Redo
  - Zoom / Fit view
  - 圖名編輯
  - 圖片匯入
  - 以 Gemini 輔助正規化
  - MySQL DDL 相關輸出與命名轉換

### 實體圖
- 由邏輯圖衍生而來，仍以資料表/欄位為核心。
- 會根據欄位與關聯重新對齊結構。
- 支援欄位編輯與邊線管理。

## AI 與匯入能力
- 圖片識別目前走本機 `Ollama`：
  - ER 圖解析：`src/lib/VisionService.ts`
  - 邏輯圖解析：`src/lib/VisionService.ts`
- 正規化相關能力分散在：
  - `src/lib/normalization.ts`
  - `src/lib/NormalizationEngine.ts`
  - `src/lib/GeminiNormalizationService.ts`
  - `src/lib/SemanticService.ts`
- 匯出 PDF 由 `html2canvas + jsPDF` 完成。

## 資料模型重點
- `Diagram` 型別包含：
  - `id`
  - `user_id`
  - `name`
  - `type`
  - `deleted_at`
  - `created_at`
  - `updated_at`
- `DiagramType` 只有三種：
  - `er`
  - `logical`
  - `physical`
- 邏輯圖核心資料：
  - `LogicalTable`
  - `LogicalField`
  - `LogicalEdge`
- 正規化檢查會辨識：
  - `1NF`：多重值、複合屬性
  - `2NF`：部分相依
  - `3NF`：遞移相依

## 重要實作細節
- `src/lib/supabase.ts` 會在缺少環境變數時回傳「假 client」，避免頁面直接崩潰。
- 分享模式會在 Supabase client 上帶入 `x-share-token` header。
- 編輯器狀態集中在 `src/store/`，並透過 broadcast channel 同步跨分頁儲存狀態。
- ER 與邏輯圖都有歷史堆疊，最大約 `80` 筆快照。
- 邏輯圖會對欄位名稱、PK/FK、資料型別、預設值等做清理與驗證。

## 環境變數
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 主要目錄
- `src/pages/`：頁面入口
- `src/components/`：畫布、節點、邊、工具列、面板
- `src/lib/`：轉換、正規化、AI、匯出、Supabase 相關邏輯
- `src/store/`：Zustand 狀態切片
- `src/types/`：共用型別
- `src/config/limits.ts`：搜尋與 AI 超時等限制常數

## 測試範圍
- 目前可見測試主要集中在：
  - `src/lib/__tests__/NormalizationEngine.test.ts`
- 新增功能時，優先補：
  - 轉換邏輯測試
  - 正規化規則測試
  - 編輯器狀態更新測試

## 工作時的注意事項
- 這個專案有大量圖表與狀態同步邏輯，修改時要注意：
  - `ER / logical / physical` 三條流程是否一致
  - 分享模式是否仍可讀寫分流
  - 跨分頁同步是否受影響
  - `Supabase` 缺環境變數時的 fallback 行為
- 如果要改動資料結構，先檢查：
  - `src/types/index.ts`
  - `src/store/*`
  - `src/lib/*` 的轉換與驗證邏輯
