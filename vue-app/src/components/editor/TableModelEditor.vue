<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  content: {
    type: Object,
    default: () => ({ tables: [], fkLinks: [], nextId: 1 }),
  },
  mode: { type: String, default: 'logical' },
  showFk: { type: Boolean, default: true },
})

const emit = defineEmits(['update:content'])

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeColumn(column, index = 0) {
  return {
    id: column?.id || `c_${Math.random().toString(36).slice(2, 8)}`,
    name: column?.name || `column_${index + 1}`,
    dataType: column?.dataType || column?.type || 'text',
    pk: !!column?.pk,
    nullable: column?.nullable !== false,
  }
}

function normalizeTable(table, index = 0) {
  const columns = Array.isArray(table?.columns)
    ? table.columns.map((column, i) => normalizeColumn(column, i))
    : [normalizeColumn(null, 0)]
  return {
    id: table?.id || `t_${Math.random().toString(36).slice(2, 8)}`,
    name: table?.name || `table_${index + 1}`,
    columns,
  }
}

function normalizeContent(content) {
  const raw = content || {}
  return {
    tables: Array.isArray(raw.tables) ? raw.tables.map((table, i) => normalizeTable(table, i)) : [],
    fkLinks: Array.isArray(raw.fkLinks) ? raw.fkLinks.map((fk) => ({ ...fk })) : [],
    nextId: Number.isFinite(raw.nextId) ? raw.nextId : 1,
    linkedErDiagramId: raw.linkedErDiagramId ?? null,
    linkedLmDiagramId: raw.linkedLmDiagramId ?? null,
    physicalStyle: raw.physicalStyle || null,
  }
}

const local = ref(normalizeContent(props.content))

watch(
  () => props.content,
  (value) => {
    local.value = normalizeContent(value)
  },
  { deep: true },
)

const modeLabel = computed(() => {
  if (props.mode === 'table') return 'Physical Table'
  if (props.mode === 'physical') return 'Physical Model'
  return 'Logical Model'
})

const allColumns = computed(() =>
  local.value.tables.flatMap((table) =>
    table.columns.map((column) => ({
      tableId: table.id,
      tableName: table.name,
      columnId: column.id,
      columnName: column.name,
      label: `${table.name}.${column.name}`,
    })),
  ),
)

function commit() {
  const payload = {
    tables: deepClone(local.value.tables),
    fkLinks: props.showFk ? deepClone(local.value.fkLinks) : [],
    nextId: local.value.nextId,
    linkedErDiagramId: local.value.linkedErDiagramId,
    linkedLmDiagramId: local.value.linkedLmDiagramId,
  }
  if (props.mode === 'table') payload.physicalStyle = 'table'
  emit('update:content', payload)
}

function nextId(prefix) {
  const id = `${prefix}${local.value.nextId}`
  local.value.nextId += 1
  return id
}

function addTable() {
  local.value.tables.push({
    id: nextId('t'),
    name: `table_${local.value.tables.length + 1}`,
    columns: [{ id: nextId('c'), name: 'id', dataType: 'uuid', pk: true, nullable: false }],
  })
  commit()
}

function removeTable(tableId) {
  local.value.tables = local.value.tables.filter((table) => table.id !== tableId)
  local.value.fkLinks = local.value.fkLinks.filter((fk) => fk.fromTableId !== tableId && fk.toTableId !== tableId)
  commit()
}

function addColumn(tableId) {
  const table = local.value.tables.find((item) => item.id === tableId)
  if (!table) return
  table.columns.push({
    id: nextId('c'),
    name: `column_${table.columns.length + 1}`,
    dataType: 'text',
    pk: false,
    nullable: true,
  })
  commit()
}

function removeColumn(tableId, columnId) {
  const table = local.value.tables.find((item) => item.id === tableId)
  if (!table) return
  table.columns = table.columns.filter((column) => column.id !== columnId)
  local.value.fkLinks = local.value.fkLinks.filter((fk) => (
    fk.fromColumnId !== columnId && fk.toColumnId !== columnId
  ))
  commit()
}

function addFk() {
  const cols = allColumns.value
  if (cols.length < 2) return
  local.value.fkLinks.push({
    id: nextId('fk'),
    fromTableId: cols[0].tableId,
    fromColumnId: cols[0].columnId,
    toTableId: cols[1].tableId,
    toColumnId: cols[1].columnId,
  })
  commit()
}

function removeFk(id) {
  local.value.fkLinks = local.value.fkLinks.filter((fk) => fk.id !== id)
  commit()
}

function onTableInput() {
  commit()
}
</script>

<template>
  <section class="table-editor">
    <header class="table-editor-toolbar">
      <div class="toolbar-title">
        <strong>{{ modeLabel }}</strong>
        <span>表數：{{ local.tables.length }}</span>
      </div>
      <div class="toolbar-actions">
        <button class="toolbar-btn" @click="addTable">新增資料表</button>
        <button v-if="showFk" class="toolbar-btn" @click="addFk">新增 FK 連線</button>
      </div>
    </header>

    <main class="table-editor-main">
      <section class="tables-grid">
        <article v-for="table in local.tables" :key="table.id" class="table-card">
          <header class="table-card-head">
            <input
              v-model="table.name"
              class="table-name-input"
              @input="onTableInput"
            />
            <button class="danger-btn" @click="removeTable(table.id)">刪除表</button>
          </header>

          <div class="column-list">
            <div v-for="column in table.columns" :key="column.id" class="column-row">
              <input v-model="column.name" @input="onTableInput" />
              <input v-model="column.dataType" @input="onTableInput" />
              <label class="flag">
                <input v-model="column.pk" type="checkbox" @change="onTableInput" />
                PK
              </label>
              <label class="flag">
                <input v-model="column.nullable" type="checkbox" @change="onTableInput" />
                NULL
              </label>
              <button class="small-btn" @click="removeColumn(table.id, column.id)">刪除</button>
            </div>
          </div>

          <button class="add-column-btn" @click="addColumn(table.id)">+ 新增欄位</button>
        </article>
      </section>

      <section v-if="showFk" class="fk-panel">
        <h3>FK 連線</h3>
        <div v-if="!local.fkLinks.length" class="muted">尚無 FK 連線</div>
        <div v-for="fk in local.fkLinks" :key="fk.id" class="fk-item">
          <select v-model="fk.fromColumnId" @change="onTableInput">
            <option v-for="col in allColumns" :key="`${fk.id}-from-${col.columnId}`" :value="col.columnId">{{ col.label }}</option>
          </select>
          <span>→</span>
          <select v-model="fk.toColumnId" @change="onTableInput">
            <option v-for="col in allColumns" :key="`${fk.id}-to-${col.columnId}`" :value="col.columnId">{{ col.label }}</option>
          </select>
          <button class="small-btn" @click="removeFk(fk.id)">刪除</button>
        </div>
      </section>
    </main>
  </section>
</template>

<style scoped>
.table-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  height: 100%;
}

.table-editor-toolbar {
  border: 1px solid var(--mac-border);
  border-radius: 12px;
  background: var(--mac-surface-strong);
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.toolbar-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.toolbar-title span {
  color: var(--mac-subtext);
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.toolbar-btn {
  border: 1px solid var(--mac-border);
  background: var(--mac-surface);
  border-radius: 9px;
  padding: 7px 10px;
  font-size: 12px;
  cursor: pointer;
}

.table-editor-main {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 12px;
  min-height: 0;
  flex: 1;
}

.tables-grid {
  border: 1px solid var(--mac-border);
  border-radius: 14px;
  background: var(--mac-surface-strong);
  padding: 10px;
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  align-content: start;
  overflow: auto;
}

.table-card {
  border: 1px solid var(--mac-border-soft);
  border-radius: 12px;
  padding: 10px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.table-card-head {
  display: flex;
  gap: 8px;
}

.table-name-input {
  flex: 1;
  border: 1px solid var(--mac-border);
  border-radius: 8px;
  padding: 7px 8px;
  font-size: 13px;
}

.column-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.column-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto auto auto;
  gap: 6px;
  align-items: center;
}

.column-row input[type='text'],
.column-row input:not([type='checkbox']) {
  border: 1px solid var(--mac-border);
  border-radius: 7px;
  padding: 6px 7px;
  font-size: 12px;
  min-width: 0;
}

.flag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--mac-subtext);
}

.small-btn,
.add-column-btn,
.danger-btn {
  border: 1px solid var(--mac-border);
  border-radius: 8px;
  background: var(--mac-surface);
  padding: 6px 8px;
  font-size: 12px;
  cursor: pointer;
}

.danger-btn {
  color: #c4453c;
  border-color: rgba(255, 69, 58, 0.35);
  background: rgba(255, 69, 58, 0.08);
  white-space: nowrap;
}

.fk-panel {
  border: 1px solid var(--mac-border);
  border-radius: 14px;
  background: var(--mac-surface-strong);
  padding: 10px;
  overflow: auto;
}

.fk-panel h3 {
  margin: 0 0 8px;
  font-size: 13px;
}

.fk-item {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}

.fk-item select {
  border: 1px solid var(--mac-border);
  border-radius: 8px;
  padding: 6px 7px;
  font-size: 12px;
  min-width: 0;
}

.muted {
  color: var(--mac-muted);
  font-size: 12px;
}

@media (max-width: 1200px) {
  .table-editor-main {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .tables-grid {
    grid-template-columns: 1fr;
  }

  .column-row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
