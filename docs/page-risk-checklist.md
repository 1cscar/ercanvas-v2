# Page-by-Page 型別 / 執行期風險清單

## `/` Home

- 風險：圖表 `type` 若非預期值，路由可能組出 `undefined`。
  - 狀態：已由 DB `check (type in ...)` 與前端建立流程固定三類型控制。
- 風險：軟刪除與垃圾桶操作失敗時無提示。
  - 狀態：已修補，所有錯誤會設定 `errorMessage` 顯示於頁面。

## `/diagram/er/:id` ERDiagram

- 風險：連線刪除與新增若不一致，可能殘留孤兒 edge。
  - 狀態：已修補，`saveER` 使用 upsert + 差異刪除（diagram 範圍）。
- 風險：節點編輯態選字使用 `execCommand` 已淘汰 API。
  - 狀態：已修補，改用 `Selection + Range`。

## `/diagram/logical/:id` LogicalDiagram

- 風險：欄位連線變更時若缺 handle，可能寫入空字串欄位 ID。
  - 狀態：已修補，`onConnect` / `onEdgesChange` 會先驗證 source/target 與 handle，再寫入。
- 風險：FK 參照更新按鈕會誤觸 toggle（把 FK 關掉）。
  - 狀態：已修補，新增 `setFieldFKRef`，更新參照不再切換 `is_fk`。
- 風險：欄位工具列切換欄位後 local state 沒同步，可能覆寫錯欄位。
  - 狀態：已修補，`FieldToolbar` 以 `useEffect` 同步 selected field state。

## `/diagram/physical/:id` PhysicalDiagram

- 風險：同 LogicalDiagram，handle 缺失會寫入非法 edge。
  - 狀態：已修補，與 Logical 同步加入 edge 輸入驗證。
- 風險：邏輯圖轉實體圖沿用原 ID，可能產生主鍵衝突。
  - 狀態：已修補，轉換時建立 table/field/edge 新 UUID 映射。

## Store / Data 層（共用）

- 風險：PostgREST `in (...)` 過濾字串格式不正確會造成刪除失效。
  - 狀態：已修補，`toInFilter` 改為 `('id1','id2')` 格式。
- 風險：畫面排序與資料排序不一致（PK 顯示置前但儲存順序不同）導致拖曳索引偏移。
  - 狀態：已修補，`loadLogical` 後直接 `reorderPkFirst`。
- 風險：實體圖欄位屬性缺欄位（`data_type` / `is_not_null` / `default_value`）。
  - 狀態：已修補，型別、store、欄位工具列、migration 已全加上。

## 尚未自動驗證的項目

- 目前執行環境缺少 `npm/tsc`，尚未跑 `npm run build`。
- 已完成靜態程式檢閱與高風險路徑修補；建議在你本機執行一次 build + 手動 smoke test。
