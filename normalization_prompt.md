# ERCanvas app.html 優化提示詞

## 專案概述
這是一個單頁應用（SPA）`app.html`（約 5861 行），包含 ER 圖、邏輯模型（Logical Model）和實體模型（Physical Model）三種圖表類型。目前所有畫面切換都是在同一頁面內用 `show('xxx')` 切換 div 顯示/隱藏。

---

## 任務一：所有圖表改為在新分頁開啟

**目前行為：**
在首頁（`scr-home`）點擊圖表卡片，呼叫 `openDiagram(id, data)` / `openLogicalDiagram(id, data)` / `openPhysicalDiagram(id, data)`，直接在同一頁面切換畫面。

**目標行為：**
點擊首頁任何圖表卡片（ER 圖、邏輯模型、實體模型）時，以新分頁開啟。實作方式：
- 點擊卡片時改為 `window.open('app.html?id=DIAGRAM_ID&type=DIAGRAM_TYPE', '_blank')`
- `app.html` 在載入時偵測 URL 參數 `id` 和 `type`，若存在則直接跳過首頁，自動從 Firestore/localStorage 讀取該圖表並開啟
- 首頁「新增 ER 圖」、「新增邏輯模型」、「新增實體模型」按鈕也改為建立後在新分頁開啟

---

## 任務二：重新設計正規化流程——新頁面 + 關聯表格

**目前行為：**
邏輯模型頁面點擊「✨ 正規化」按鈕（`#lm-btn-normalize`），開啟一個 Modal overlay（`#lm-norm-wizard`），是一個四步驟精靈（1NF → 2NF → 3NF → 確認）。完成後只是清除 normalizationFlags，不產生新頁面或新文件。

**目標行為：**

### 2.1 按下「正規化」按鈕後新開頁面

點擊「✨ 正規化」按鈕後：
1. 建立一個新的「實體模型」圖表紀錄（儲存到 Firestore + localStorage），`diagramType: 'physical'`，`physicalStyle: 'table'`，`linkedLmDiagramId` 設為目前邏輯模型的 id
2. 以新分頁開啟此實體模型頁面，URL 帶入 `?id=NEW_PHYSICAL_ID&type=physical&fromNormalize=true&lmId=LM_DIAGRAM_ID`

### 2.2 新的實體模型頁面：關聯表格（Relational Table）介面

**重要：** 當 `physicalStyle: 'table'` 時，實體模型 UI 改為試算表式關聯表格，取代原本的 SVG 畫布拖放介面。

#### 頁面結構：
- Header：ERCanvas logo | 實體模型 badge | 圖表名稱輸入框 | 儲存狀態 | 「匯出 SQL DDL」按鈕 | 登出
- Toolbar：上一步/下一步 | 存檔 | 新增資料表
- 主要內容區：關聯表格列表（垂直排列），每個資料表一個 HTML `<table>`，外框帶 border-radius 和 shadow

#### 每個資料表的視覺格式：

```
┌──────────────────────────────────────────────────┐
│  📋 資料表名稱（雙擊可編輯）          [🗑 刪除] │  ← 深藍/綠色表頭列
├─────────────┬──────────────┬──────────┬──────────┤
│   欄位名稱  │   資料型別   │   限制   │   備註   │  ← 欄標題（灰底）
├─────────────┼──────────────┼──────────┼──────────┤
│ id          │ INT          │ PK NN    │          │  ← 每一列資料
├─────────────┼──────────────┼──────────┼──────────┤
│ name        │ VARCHAR(50)  │ NN       │          │
└─────────────┴──────────────┴──────────┴──────────┘
                              ＋ 新增欄位列
```

#### 互動功能（每一列）：

1. **雙擊任一儲存格可編輯文字**（inline edit）
   - 欄位名稱、限制、備註欄：顯示 `<input type="text">`
   - 資料型別欄：顯示 `<select>` 下拉選單，選項：`INT`, `BIGINT`, `VARCHAR(50)`, `VARCHAR(255)`, `TEXT`, `BOOLEAN`, `DATE`, `DATETIME`, `TIMESTAMP`, `FLOAT`, `DECIMAL(10,2)`, `JSON`，也可直接輸入自訂值
   - 按 Enter 或點擊外部確認，按 Escape 取消

2. **每一列 hover 時，右側出現操作按鈕（或右鍵選單）：**
   - 「↑ 在上方插入列」
   - 「↓ 在下方插入列」
   - 「✕ 刪除此列」

3. **資料表底部「＋ 新增欄位」按鈕**：點擊後在表格末尾追加空白列

4. **資料表表名**：雙擊可重新命名

5. **刪除整個資料表**：表頭右上角「刪除」按鈕，點擊後確認才刪除

#### 從邏輯模型自動轉換（`fromNormalize=true`）：

讀取 `lmId` 對應的邏輯模型資料（從 localStorage 或 Firestore），自動轉換為關聯表：
- 邏輯模型每個 table → 一個資料表
- column.name → 欄位名稱
- column.pk=true → 限制欄填入 `PK`
- column.fk=true → 限制欄加入 `FK`
- column.pk && column.fk → 限制欄填入 `PK, FK`
- 資料型別欄初始為空（讓使用者填寫）
- 備註欄初始為空

#### 資料結構（儲存格式）：

```javascript
// physicalStyle: 'table' 時的資料
{
  diagramType: 'physical',
  physicalStyle: 'table',          // 區分新舊介面
  name: '未命名實體模型',
  linkedLmDiagramId: 'lm_xxx',
  tables: [
    {
      id: 'pt1',
      name: '資料表名稱',
      rows: [
        {
          id: 'pr1',
          fieldName: 'id',
          dataType: 'INT',
          constraints: 'PK, NOT NULL',
          notes: ''
        }
      ]
    }
  ],
  nextId: 1,
  updatedAt: ...
}
```

---

## 任務三：保留舊 SVG 畫布式實體模型（相容性）

- 從首頁「新增實體模型」按鈕建立的，`physicalStyle` 預設為 `'canvas'`（或不設定），沿用原本的 SVG 畫布介面
- 只有從「✨ 正規化」按鈕建立的，`physicalStyle: 'table'`，使用新的關聯表格介面
- `openPhysicalDiagram(id, data)` 中根據 `data.physicalStyle === 'table'` 決定顯示哪個 UI 區塊

---

## 技術細節

### 相關程式碼位置：
- `openWizard()` at line ~4708：目前正規化入口，需改為：建立新 physical 圖表 → 新分頁開啟
- `openPhysicalDiagram(id, data)` at line ~5696：需加入 `physicalStyle` 分流
- 首頁卡片點擊邏輯 at line ~1754+（`loadHome()`、`loadHomeFast()`）：改為 `window.open`
- `show(name)` at line ~1562：URL 參數偵測在此初始化附近加入
- `btn-new-diagram/btn-new-logical/btn-new-physical` click handlers at line ~2131+：改為新分頁

### URL 參數啟動邏輯：
在 Firebase `onAuthStateChanged` 確認登入後加入：
```javascript
const urlParams = new URLSearchParams(window.location.search);
const directId = urlParams.get('id');
const directType = urlParams.get('type');
const fromNormalize = urlParams.get('fromNormalize') === 'true';
const lmId = urlParams.get('lmId');
if (directId && directType) {
  // 從 localStorage 或 Firestore 讀取圖表資料後直接開啟
  // 跳過首頁
}
```

### 新分頁開啟工具函數：
```javascript
function openDiagramInNewTab(id, type, extraParams = '') {
  window.open(`app.html?id=${encodeURIComponent(id)}&type=${type}${extraParams}`, '_blank');
}
```

---

## 注意事項

1. 正規化精靈 Modal（`#lm-norm-wizard`）可以保留不刪除，只改變「✨ 正規化」按鈕的行為
2. 中文 UI 文字保持一致風格
3. 儲存機制沿用既有的 localStorage + Firestore 雙軌
4. 關聯表格 UI 需要響應式，在較小螢幕可橫向捲動
5. 匯出 SQL DDL 功能需能從新的 `tables[].rows[]` 結構產生 CREATE TABLE 語句
