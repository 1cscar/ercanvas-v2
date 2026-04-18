# Vue Componentization Audit

## 2026-04-18 Takeover Status

Vue takeover is now complete at runtime path level:

- `/editor` no longer embeds `app.html`.
- Editor runtime is now native Vue components:
  - `vue-app/src/components/editor/ErDiagramEditor.vue`
  - `vue-app/src/components/editor/TableModelEditor.vue`
- Persistence is unified through Supabase store:
  - `vue-app/src/stores/diagrams.js` with `saveDiagram(...)`
- Routing now includes Vue landing page:
  - `vue-app/src/views/LandingView.vue`
- Deployment routing no longer keeps `app.html` as runtime target:
  - `vercel.json` rewritten to SPA-first route handling.
- Root legacy html files have been reduced to redirect shims:
  - `index.html`
  - `app.html`

Result:

- Vue controls component lifecycle end-to-end.
- Supabase controls cross-device synchronization end-to-end.
- Legacy monolithic HTML runtime is removed from active execution path.

## Current State

Already on Vue + Supabase:

- Auth shell: `vue-app/src/stores/auth.js`
- Diagram list CRUD store: `vue-app/src/stores/diagrams.js`
- Home route and shell: `vue-app/src/views/HomeView.vue`
- Shared domain mapping: `vue-app/src/domain/*`

Still legacy and high-risk:

- Full editor runtime: `app.html`
- Legacy boot/auth/show-screen flow: `app.html:3779-3887`
- Legacy home duplicate: `app.html:957-1074`, `app.html:4244-4838`
- ER editor: `app.html:1075-1851`, `app.html:4451-6416`
- Logical editor: `app.html:1852-2091`, `app.html:7804-8922`
- Physical table editor: `app.html:2092-2224`, `app.html:9752-10182`
- Physical relation editor: `app.html:2225-2460`, `app.html:8952-9671`

## 2026-04-18 Full Check (Round 2)

### Fixed in this round

- Direct-open fail-open path strengthened in `app.html`:
  - Added hard timeout wrapper for direct fetch path.
  - Added `direct-open-prefetch-only` completion path (if remote fetch times out but prefetch is available, editor still opens).
  - Enabled fallback timer even when startup did not come from cached-session branch.
  - Added null-safe behavior in `openDiagramByType(...)` to prevent spinner lock when payload is empty/invalid.
- Auth boot guard strengthened:
  - `watchAuthState(...)` now catches `getSession` failure and degrades to `handler(null)` instead of hanging.
- Vue diagrams store resilience:
  - Added query timeout wrapper in `vue-app/src/stores/diagrams.js` for list/create/fetch/rename/trash/restore/delete/batch operations.
  - Prevents button clicks from appearing "no response" when Supabase request stalls.
- Vue editor shell UX:
  - `vue-app/src/views/EditorView.vue` now auto-clears prefetch status after timeout and clears prefetch status once iframe load event arrives.

### Pressure checks executed

- `app.html` inline script syntax check (Node `--check`): pass.
- Vue build (`vite build`): pass.
- Mapping + prefetch stress:
  - `rowToDiagram` 8000 rows: ~2.03ms
  - `createDiagramInsert` 3000 ops: ~0.88ms
  - sample prefetch payload: 2383 bytes

### Remaining migration debt (not yet eliminated)

- `app.html` still contains very high imperative UI surface:
  - `document.getElementById/querySelector/addEventListener` hits: `599+`.
- Legacy editor runtime is still single-file and owns tool-level interactions, so full dead-click elimination still requires moving ER/LM/PM/PT editors into Vue components + Pinia stores.

## Why Clicks Still Fail

The remaining dead-click problems are caused by mixed ownership:

1. Vue owns `/home`, but `/editor` still hands control to `app.html`.
2. `app.html` still uses imperative `document.getElementById(...).addEventListener(...)` bindings for navigation, creation, back buttons, save buttons, and editor tools.
3. Legacy navigation still bypasses Vue Router via direct `window.location.href`.
4. Mobile / IAB interaction is especially fragile because the old home/editor interactions were built around desktop hover and right-click patterns.

## What I Already Changed

To reduce list-page interaction failures, the Vue home shell now has:

- touch-friendly card action buttons instead of only context-menu actions
- explicit open / rename / trash / restore / permanent delete buttons
- componentized sidebar and diagram cards

New Vue components:

- `vue-app/src/components/home/HomeSidebar.vue`
- `vue-app/src/components/home/DiagramCard.vue`

## Required Migration Work

### 1. Remove Legacy Home Ownership

Legacy home should be fully retired.

Evidence:

- Home screen markup: `app.html:957`
- Home loading / snapshot flow: `app.html:4244`
- Trash flow: `app.html:4605`
- Legacy create buttons: `app.html:4791`, `app.html:4812`, `app.html:4829`

Target Vue replacement:

- Keep all list, trash, rename, create, delete in `HomeView.vue`
- Do not call legacy home logic from editor exit paths
- Replace every `show('home')` / `window.location.href='/'` return path with Vue route navigation

### 2. Replace Direct Location Navigation

Current direct navigation count is still high:

- `window.location.href = \`app.html...\`` appears 9 times
- `window.location.href = '/'` appears 4 times

These are the main collision points between Vue Router and the legacy page.

Target change:

- Add a Vue-side editor shell route for each editor mode
- Replace direct page navigation with router pushes
- Stop using `/app.html` as the state source for transitions

### 3. Split Editor by Mode into Vue Views

The legacy editor is already divided by screen, so migrate in this order:

1. ER editor
2. Logical model editor
3. Physical relation editor
4. Physical table editor

Suggested Vue views:

- `vue-app/src/views/editor/ErEditorView.vue`
- `vue-app/src/views/editor/LogicalEditorView.vue`
- `vue-app/src/views/editor/PhysicalEditorView.vue`
- `vue-app/src/views/editor/PhysicalTableEditorView.vue`

### 4. Extract Editor State into Pinia Stores

The imperative global state in `app.html` should become stores.

Suggested stores:

- `vue-app/src/stores/editorEr.js`
- `vue-app/src/stores/editorLogical.js`
- `vue-app/src/stores/editorPhysical.js`
- `vue-app/src/stores/editorPhysicalTable.js`
- `vue-app/src/stores/editorUi.js`

Each store should own:

- canvas data
- selection state
- undo/redo state
- autosave state
- collaborator cursor state
- linked diagram ids

### 5. Extract Cross-Cutting Composables

These behaviors are duplicated across modes and should not stay inside one huge file.

Suggested composables:

- `vue-app/src/composables/useDiagramPersistence.js`
- `vue-app/src/composables/usePresenceChannel.js`
- `vue-app/src/composables/useUndoRedo.js`
- `vue-app/src/composables/useCanvasViewport.js`
- `vue-app/src/composables/useTouchPanZoom.js`
- `vue-app/src/composables/useEditorNavigation.js`

### 6. Convert Legacy Toolbars and Modals into Components

The old file contains roughly 193 interactive ids. These should become components, not manual DOM lookups.

Highest-priority components:

- app header / mode header
- save status
- zoom controls
- side panels
- node/table toolbar
- rename inputs
- bind-link dialogs
- normalize wizard panels
- export SQL modal
- share / access control panel

Suggested component tree:

- `components/editor/common/EditorHeader.vue`
- `components/editor/common/EditorSidebar.vue`
- `components/editor/common/ZoomControls.vue`
- `components/editor/common/SaveIndicator.vue`
- `components/editor/common/ConfirmDialog.vue`
- `components/editor/er/NodeToolbar.vue`
- `components/editor/er/TypePicker.vue`
- `components/editor/logical/TableToolbar.vue`
- `components/editor/logical/NormalizeWizard.vue`
- `components/editor/physical/ColumnToolbar.vue`
- `components/editor/physical/SqlExportDialog.vue`
- `components/editor/physical/LinkLogicalDialog.vue`

### 7. Keep Domain Logic, Move UI Logic

These areas should stay shared and pure:

- diagram type normalization
- row/content mapping
- ER -> logical conversion
- logical -> physical conversion

These areas must move out of `app.html`:

- DOM queries
- visibility switching via `show(...)`
- per-button event binding
- `window.location.href` transitions
- duplicated login / setup / home screens

## Recommended Migration Order

### Phase A

- Keep current Vue home shell as the only home implementation
- Stop returning from legacy editor to legacy home
- Add explicit Vue routes for each editor mode

### Phase B

- Move ER editor shell into Vue
- Reuse existing domain mapping and Supabase persistence
- Keep only canvas mechanics in the first pass

### Phase C

- Move logical editor and normalization wizard
- Extract link-to-ER and convert-to-physical flows

### Phase D

- Move physical editor and physical-table editor
- Move SQL export dialog and PT normalization

### Phase E

- Delete legacy setup/login/home screens from `app.html`
- Delete remaining direct `window.location.href` editor transitions
- Delete legacy DOM event bindings once Vue owns the last editor mode

## Immediate Files To Modify Next

- `vue-app/src/router/index.js`
- `vue-app/src/views/EditorView.vue`
- `vue-app/src/views/HomeView.vue`
- `vue-app/src/stores/diagrams.js`
- `app.html`

## Immediate Files To Add Next

- `vue-app/src/views/editor/ErEditorView.vue`
- `vue-app/src/stores/editorEr.js`
- `vue-app/src/composables/useDiagramPersistence.js`
- `vue-app/src/composables/useUndoRedo.js`
- `vue-app/src/components/editor/common/EditorHeader.vue`
