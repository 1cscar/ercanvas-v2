<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import KonvaHugeCanvas from '@/components/editor/konva/KonvaHugeCanvas.vue'

const props = defineProps({
  content: {
    type: Object,
    default: () => ({ tables: [], fkLinks: [], nextId: 1 }),
  },
  mode: { type: String, default: 'logical' },
  showFk: { type: Boolean, default: true },
})

const emit = defineEmits(['update:content'])

const TABLE_ROW_HEIGHT = 40
const TABLE_ROW_HEIGHT_PHYSICAL = 52
const TABLE_CELL_MIN_WIDTH = 92
const TABLE_CELL_MAX_WIDTH = 220
const TABLE_TITLE_HEIGHT = 42
const TABLE_TITLE_GAP = 8
const LINK_PORT_OUTSET = 0
const LINK_CLEARANCE = 24
const LINK_OBSTACLE_PADDING = 14
const LINK_INTERSECTION_PENALTY = 100000
const LINK_CURVE_TENSION = 0.48
const LOGICAL_CENTER = { x: 55000 / 2, y: 35000 / 2 }

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeColumn(column, index = 0) {
  return {
    id: column?.id || `c_${Math.random().toString(36).slice(2, 8)}`,
    name: column?.name || `column_${index + 1}`,
    dataType: column?.dataType || column?.type || 'text',
    pk: !!column?.pk,
    fk: !!column?.fk,
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
    x: Number.isFinite(table?.x) ? Number(table.x) : (60 + (index % 3) * 380),
    y: Number.isFinite(table?.y) ? Number(table.y) : (50 + Math.floor(index / 3) * 280),
    columns,
  }
}

function normalizeFk(link) {
  return {
    id: link?.id || `fk_${Math.random().toString(36).slice(2, 8)}`,
    fromTableId: link?.fromTableId || '',
    fromColumnId: link?.fromColumnId || '',
    toTableId: link?.toTableId || '',
    toColumnId: link?.toColumnId || '',
  }
}

function normalizeContent(content) {
  const raw = content || {}
  const tables = Array.isArray(raw.tables) ? raw.tables.map((table, i) => normalizeTable(table, i)) : []
  const tableById = new Map(tables.map((table) => [table.id, table]))
  const fkLinks = Array.isArray(raw.fkLinks)
    ? raw.fkLinks
        .map(normalizeFk)
        .filter((fk) => {
          const fromTable = tableById.get(fk.fromTableId)
          const toTable = tableById.get(fk.toTableId)
          if (!fromTable || !toTable) return false
          const fromColOk = fromTable.columns.some((column) => column.id === fk.fromColumnId)
          const toColOk = toTable.columns.some((column) => column.id === fk.toColumnId)
          return fromColOk && toColOk
        })
    : []
  return {
    tables,
    fkLinks,
    nextId: Number.isFinite(raw.nextId) ? Number(raw.nextId) : 1,
    linkedErDiagramId: raw.linkedErDiagramId ?? null,
    linkedLmDiagramId: raw.linkedLmDiagramId ?? null,
    physicalStyle: raw.physicalStyle || null,
  }
}

const local = ref(normalizeContent(props.content))
const canvasApi = ref(null)
const canvasPanelRef = ref(null)
const viewport = ref({ scale: 1, x: 24, y: 24 })

const selectedTableId = ref('')
const selectedColumnKey = ref('')
const selectedFkId = ref('')
const linkModeSource = ref(null)
const hasAutoCentered = ref(false)

const floatingToolbar = ref({ x: Math.max(12, window.innerWidth - 200), y: 72 })
let floatingDragState = null

function onViewportChange(vp) {
  viewport.value = { scale: vp.scale, x: vp.position.x, y: vp.position.y }
  positionToolbarNearSelection()
}

function positionToolbarNearSelection() {
  const panel = canvasPanelRef.value
  if (!panel) return

  const selectedTableValue = selectedColumn.value?.table || selectedTable.value
  if (!selectedTableValue) {
    const w = panel.clientWidth || window.innerWidth
    floatingToolbar.value.x = Math.max(12, w - 196)
    floatingToolbar.value.y = 74
    return
  }

  const metrics = getTableMetrics(selectedTableValue)
  const { scale, x: vx, y: vy } = viewport.value
  const toolbarWidth = 176
  const toolbarHeight = selectedColumn.value ? 258 : 146
  const anchorX = selectedTableValue.x * scale + vx + metrics.rowWidth * scale + 10
  const anchorY = selectedColumn.value
    ? selectedTableValue.y * scale + vy + metrics.rowY * scale - 6
    : selectedTableValue.y * scale + vy + 6

  floatingToolbar.value.x = Math.max(12, Math.min(anchorX, panel.clientWidth - toolbarWidth - 8))
  floatingToolbar.value.y = Math.max(12, Math.min(anchorY, panel.clientHeight - toolbarHeight - 8))
}

function stopFloatingDrag() {
  if (!floatingDragState) return
  window.removeEventListener('mousemove', onFloatingDragMove)
  window.removeEventListener('mouseup', stopFloatingDrag)
  floatingDragState = null
}

function onFloatingDragMove(event) {
  if (!floatingDragState) return
  const panel = canvasPanelRef.value
  if (!panel) return
  const nextX = floatingDragState.startX + (event.clientX - floatingDragState.pointerX)
  const nextY = floatingDragState.startY + (event.clientY - floatingDragState.pointerY)
  floatingToolbar.value.x = Math.max(12, Math.min(nextX, panel.clientWidth - 176))
  floatingToolbar.value.y = Math.max(12, Math.min(nextY, panel.clientHeight - 260))
}

function startFloatingDrag(event) {
  event.preventDefault()
  floatingDragState = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    startX: floatingToolbar.value.x,
    startY: floatingToolbar.value.y,
  }
  window.addEventListener('mousemove', onFloatingDragMove)
  window.addEventListener('mouseup', stopFloatingDrag)
}

const modeLabel = computed(() => {
  if (props.mode === 'table') return 'Physical Table'
  if (props.mode === 'physical') return 'Physical Model'
  return 'Logical Model'
})

const selectedTable = computed(() => local.value.tables.find((table) => table.id === selectedTableId.value) || null)
const selectedColumn = computed(() => {
  if (!selectedColumnKey.value) return null
  const [tableId, columnId] = selectedColumnKey.value.split(':')
  const table = local.value.tables.find((item) => item.id === tableId)
  const column = table?.columns.find((item) => item.id === columnId)
  if (!table || !column) return null
  return { table, column }
})

const modeHint = computed(() => {
  if (!props.showFk) return 'Table 模式：可拖曳資料表與編輯欄位。'
  if (linkModeSource.value) return '新增連線模式：點選目標欄位完成箭頭連線；再點同一欄位可取消。'
  return '選取欄位後可進入新增連線模式，再點另一個欄位完成連線。'
})

watch(
  () => props.content,
  (value) => {
    local.value = normalizeContent(value)
    syncSelection()
    renderScene()
  },
  { deep: true },
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

function syncSelection() {
  if (selectedTableId.value && !local.value.tables.some((table) => table.id === selectedTableId.value)) {
    selectedTableId.value = ''
  }
  if (selectedColumnKey.value) {
    const [tableId, columnId] = selectedColumnKey.value.split(':')
    const table = local.value.tables.find((item) => item.id === tableId)
    if (!table || !table.columns.some((col) => col.id === columnId)) selectedColumnKey.value = ''
  }
  if (selectedFkId.value && !local.value.fkLinks.some((fk) => fk.id === selectedFkId.value)) selectedFkId.value = ''
}

function nextId(prefix) {
  const id = `${prefix}${local.value.nextId}`
  local.value.nextId += 1
  return id
}

function columnKey(tableId, columnId) {
  return `${tableId}:${columnId}`
}

function addTable() {
  const idx = local.value.tables.length
  local.value.tables.push({
    id: nextId('t'),
    name: `table_${idx + 1}`,
    x: 60 + (idx % 2) * 460,
    y: 50 + Math.floor(idx / 2) * 210,
    columns: [{ id: nextId('c'), name: 'id', dataType: 'uuid', pk: true, fk: false, nullable: false }],
  })
  commit()
  renderScene()
}

function addColumn(tableId) {
  const table = local.value.tables.find((item) => item.id === tableId)
  if (!table) return
  table.columns.push({
    id: nextId('c'),
    name: `column_${table.columns.length + 1}`,
    dataType: 'text',
    pk: false,
    fk: false,
    nullable: true,
  })
  commit()
  renderScene()
}

function removeTable(tableId) {
  local.value.tables = local.value.tables.filter((table) => table.id !== tableId)
  local.value.fkLinks = local.value.fkLinks.filter((fk) => fk.fromTableId !== tableId && fk.toTableId !== tableId)
  if (selectedTableId.value === tableId) selectedTableId.value = ''
  if (selectedColumnKey.value.startsWith(`${tableId}:`)) selectedColumnKey.value = ''
  if (linkModeSource.value?.tableId === tableId) linkModeSource.value = null
  selectedFkId.value = ''
  commit()
  renderScene()
}

function removeColumn(tableId, columnId) {
  const table = local.value.tables.find((item) => item.id === tableId)
  if (!table) return
  table.columns = table.columns.filter((column) => column.id !== columnId)
  local.value.fkLinks = local.value.fkLinks.filter((fk) => (
    fk.fromColumnId !== columnId && fk.toColumnId !== columnId
  ))
  if (selectedColumnKey.value === columnKey(tableId, columnId)) selectedColumnKey.value = ''
  if (linkModeSource.value?.tableId === tableId && linkModeSource.value?.columnId === columnId) linkModeSource.value = null
  selectedFkId.value = ''
  commit()
  renderScene()
}

function removeSelected() {
  if (selectedFkId.value) {
    local.value.fkLinks = local.value.fkLinks.filter((fk) => fk.id !== selectedFkId.value)
    selectedFkId.value = ''
    commit()
    renderScene()
    return
  }
  if (selectedColumn.value) {
    removeColumn(selectedColumn.value.table.id, selectedColumn.value.column.id)
    return
  }
  if (selectedTableId.value) {
    removeTable(selectedTableId.value)
  }
}

function toggleLinkMode() {
  if (!props.showFk || !selectedColumn.value) return
  const key = columnKey(selectedColumn.value.table.id, selectedColumn.value.column.id)
  const sourceKey = linkModeSource.value ? columnKey(linkModeSource.value.tableId, linkModeSource.value.columnId) : ''
  if (sourceKey === key) {
    linkModeSource.value = null
    renderScene()
    return
  }
  linkModeSource.value = {
    tableId: selectedColumn.value.table.id,
    columnId: selectedColumn.value.column.id,
  }
  renderScene()
}

function createFk(fromTableId, fromColumnId, toTableId, toColumnId) {
  if (!props.showFk) return null
  if (!fromTableId || !fromColumnId || !toTableId || !toColumnId) return null
  if (fromTableId === toTableId && fromColumnId === toColumnId) return null
  const exists = local.value.fkLinks.some((fk) => (
    fk.fromTableId === fromTableId &&
    fk.fromColumnId === fromColumnId &&
    fk.toTableId === toTableId &&
    fk.toColumnId === toColumnId
  ))
  if (exists) return null
  const fk = {
    id: nextId('fk'),
    fromTableId,
    fromColumnId,
    toTableId,
    toColumnId,
  }
  local.value.fkLinks.push(fk)
  selectedFkId.value = fk.id
  commit()
  return fk
}

function onFieldInput() {
  commit()
  renderScene()
}

function onLogicalClick() {
  if (linkModeSource.value) return
  selectedTableId.value = ''
  selectedColumnKey.value = ''
  selectedFkId.value = ''
  renderScene()
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function buildColumnText(column) {
  return column.name
}

function estimateCellWidth(column) {
  const titleWidth = buildColumnText(column).length * 11 + 28
  const metaText = props.mode === 'physical' ? `${column.dataType || ''}${column.nullable ? '' : ' NN'}` : ''
  const metaWidth = metaText.length * 8 + 24
  return clamp(Math.max(titleWidth, metaWidth, TABLE_CELL_MIN_WIDTH), TABLE_CELL_MIN_WIDTH, TABLE_CELL_MAX_WIDTH)
}

function getTableMetrics(table) {
  const cellWidths = table.columns.map((column) => estimateCellWidth(column))
  const titleWidth = table.name.length * 18 + 48
  const rowWidth = Math.max(cellWidths.reduce((sum, width) => sum + width, 0), titleWidth, TABLE_CELL_MIN_WIDTH)
  const rowHeight = props.mode === 'physical' ? TABLE_ROW_HEIGHT_PHYSICAL : TABLE_ROW_HEIGHT
  const rowY = TABLE_TITLE_HEIGHT + TABLE_TITLE_GAP
  return {
    cellWidths,
    rowWidth,
    titleHeight: TABLE_TITLE_HEIGHT,
    rowY,
    rowHeight,
    totalHeight: rowY + rowHeight,
  }
}

function getColumnAnchor(table, columnId, side = 'right') {
  const idx = table.columns.findIndex((col) => col.id === columnId)
  if (idx < 0) return null
  const metrics = getTableMetrics(table)
  const startX = metrics.cellWidths.slice(0, idx).reduce((sum, width) => sum + width, 0)
  const width = metrics.cellWidths[idx]
  const centerX = table.x + startX + width / 2
  const centerY = table.y + metrics.rowY + metrics.rowHeight / 2
  if (side === 'left') return { x: table.x - LINK_PORT_OUTSET, y: centerY }
  if (side === 'top') return { x: centerX, y: table.y + metrics.rowY - LINK_PORT_OUTSET }
  if (side === 'bottom') return { x: centerX, y: table.y + metrics.rowY + metrics.rowHeight + LINK_PORT_OUTSET }
  if (side === 'center') return { x: centerX, y: centerY }
  return {
    x: table.x + metrics.rowWidth + LINK_PORT_OUTSET,
    y: centerY,
  }
}

function getTableRect(table, padding = 0) {
  const metrics = getTableMetrics(table)
  return {
    left: table.x - padding,
    top: table.y - padding,
    right: table.x + metrics.rowWidth + padding,
    bottom: table.y + metrics.totalHeight + padding,
  }
}

function segmentIntersectsRect(a, b, rect) {
  if (Math.abs(a.x - b.x) < 0.001) {
    const x = a.x
    if (x <= rect.left || x >= rect.right) return false
    const minY = Math.min(a.y, b.y)
    const maxY = Math.max(a.y, b.y)
    return maxY > rect.top && minY < rect.bottom
  }

  if (Math.abs(a.y - b.y) < 0.001) {
    const y = a.y
    if (y <= rect.top || y >= rect.bottom) return false
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    return maxX > rect.left && minX < rect.right
  }

  return false
}

function simplifyPolyline(points) {
  const deduped = []
  for (const p of points) {
    const prev = deduped[deduped.length - 1]
    if (!prev || Math.abs(prev.x - p.x) > 0.001 || Math.abs(prev.y - p.y) > 0.001) deduped.push(p)
  }
  if (deduped.length <= 2) return deduped

  const simplified = [deduped[0]]
  for (let i = 1; i < deduped.length - 1; i += 1) {
    const prev = simplified[simplified.length - 1]
    const cur = deduped[i]
    const next = deduped[i + 1]
    const sameX = Math.abs(prev.x - cur.x) < 0.001 && Math.abs(cur.x - next.x) < 0.001
    const sameY = Math.abs(prev.y - cur.y) < 0.001 && Math.abs(cur.y - next.y) < 0.001
    if (!sameX && !sameY) simplified.push(cur)
  }
  simplified.push(deduped[deduped.length - 1])
  return simplified
}

function polylineIntersections(points, obstacles) {
  let hits = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    for (const rect of obstacles) {
      if (segmentIntersectsRect(points[i], points[i + 1], rect)) hits += 1
    }
  }
  return hits
}

function polylineLength(points) {
  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y)
  }
  return total
}

function chooseAnchorSides(fromTable, fromColumnId, toTable, toColumnId) {
  const fromCenter = getColumnAnchor(fromTable, fromColumnId, 'center')
  const toCenter = getColumnAnchor(toTable, toColumnId, 'center')
  if (!fromCenter || !toCenter) return ['right', 'left']
  const dx = toCenter.x - fromCenter.x
  const dy = toCenter.y - fromCenter.y
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
  return dx >= 0 ? ['right', 'left'] : ['left', 'right']
}

function routePolyline(start, end, obstacles) {
  const candidates = []
  const xTracks = [Math.round((start.x + end.x) / 2)]
  const yTracks = [Math.round((start.y + end.y) / 2)]

  for (const rect of obstacles) {
    xTracks.push(Math.round(rect.left - LINK_CLEARANCE))
    xTracks.push(Math.round(rect.right + LINK_CLEARANCE))
    yTracks.push(Math.round(rect.top - LINK_CLEARANCE))
    yTracks.push(Math.round(rect.bottom + LINK_CLEARANCE))
  }

  candidates.push(simplifyPolyline([start, { x: end.x, y: start.y }, end]))
  candidates.push(simplifyPolyline([start, { x: start.x, y: end.y }, end]))

  for (const xTrack of xTracks) {
    candidates.push(simplifyPolyline([start, { x: xTrack, y: start.y }, { x: xTrack, y: end.y }, end]))
  }
  for (const yTrack of yTracks) {
    candidates.push(simplifyPolyline([start, { x: start.x, y: yTrack }, { x: end.x, y: yTrack }, end]))
  }

  let best = simplifyPolyline([start, { x: end.x, y: start.y }, end])
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const intersections = polylineIntersections(candidate, obstacles)
    const bends = Math.max(0, candidate.length - 2)
    const score = (intersections * LINK_INTERSECTION_PENALTY) + (bends * 40) + polylineLength(candidate)
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }

  return best
}

function ensureCurveWaypoint(points) {
  if (points.length > 2) return points
  const [start, end] = points
  if (!start || !end) return points
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.abs(dx) + Math.abs(dy) < 1) return points
  const curveMagnitude = clamp(Math.max(Math.abs(dx), Math.abs(dy)) * 0.22, 28, 96)
  const mid = {
    x: (start.x + end.x) / 2 + (dy >= 0 ? -curveMagnitude : curveMagnitude),
    y: (start.y + end.y) / 2 + (dx >= 0 ? curveMagnitude : -curveMagnitude),
  }
  return [start, mid, end]
}

function drawTable(Konva, objectGroup, table, cullingNodes) {
  const metrics = getTableMetrics(table)
  const isSelected = selectedTableId.value === table.id
  const group = new Konva.Group({
    x: table.x,
    y: table.y,
    draggable: true,
  })

  group.add(new Konva.Rect({
    x: 0,
    y: metrics.rowY,
    width: metrics.rowWidth,
    height: metrics.rowHeight,
    fill: '#ffffff',
    stroke: isSelected ? '#0a84ff' : '#46505e',
    strokeWidth: isSelected ? 2.2 : 2,
  }))

  group.add(new Konva.Text({
    x: 0,
    y: 6,
    width: metrics.rowWidth,
    text: table.name,
    fontSize: 20,
    fontStyle: '900',
    fill: '#111827',
    align: 'center',
    verticalAlign: 'middle',
    ellipsis: true,
    listening: false,
  }))

  let offsetX = 0
  for (let i = 0; i < table.columns.length; i += 1) {
    const col = table.columns[i]
    const width = metrics.cellWidths[i]
    const key = columnKey(table.id, col.id)
    const isColSelected = selectedColumnKey.value === key
    const isLinkSource = linkModeSource.value
      && linkModeSource.value.tableId === table.id
      && linkModeSource.value.columnId === col.id

    if (isColSelected || isLinkSource) {
      group.add(new Konva.Rect({
        x: offsetX + 1.2,
        y: metrics.rowY + 1.2,
        width: width - 2.4,
        height: metrics.rowHeight - 2.4,
        fill: isLinkSource ? 'rgba(255,149,0,0.20)' : 'rgba(10,132,255,0.14)',
      }))
    }

    group.add(new Konva.Text({
      x: offsetX,
      y: metrics.rowY + 9,
      width,
      align: 'center',
      text: buildColumnText(col),
      fontSize: 13.5,
      fill: '#0f172a',
      textDecoration: col.pk ? 'underline' : '',
      listening: false,
    }))

    if (props.mode === 'physical') {
      group.add(new Konva.Text({
        x: offsetX,
        y: metrics.rowY + 27,
        width,
        align: 'center',
        text: `${col.dataType || ''}${col.nullable ? '' : ' NN'}`.trim(),
        fontSize: 10,
        fill: '#64748b',
        listening: false,
      }))
    }

    if (i < table.columns.length - 1) {
      group.add(new Konva.Line({
        points: [offsetX + width, metrics.rowY, offsetX + width, metrics.rowY + metrics.rowHeight],
        stroke: '#46505e',
        strokeWidth: 1.6,
        listening: false,
      }))
    }

    group.add(new Konva.Text({
      x: offsetX + width - 18,
      y: metrics.rowY + (props.mode === 'physical' ? 17 : 11),
      width: 14,
      align: 'center',
      text: '⋮',
      fontSize: 13,
      fill: '#94a3b8',
      listening: false,
    }))

    offsetX += width
  }

  group.on('click tap', (evt) => {
    evt.cancelBubble = true
    const p = group.getRelativePointerPosition()
    if (!p) return
    if (p.y < metrics.rowY) {
      selectedTableId.value = table.id
      selectedColumnKey.value = ''
      selectedFkId.value = ''
      renderScene()
      return
    }
    if (p.y > metrics.rowY + metrics.rowHeight) return

    let cursor = 0
    let col = null
    for (let i = 0; i < table.columns.length; i += 1) {
      const width = metrics.cellWidths[i]
      if (p.x >= cursor && p.x <= cursor + width) {
        col = table.columns[i]
        break
      }
      cursor += width
    }
    if (!col) return

    const key = columnKey(table.id, col.id)
    if (props.showFk && linkModeSource.value) {
      const sourceKey = columnKey(linkModeSource.value.tableId, linkModeSource.value.columnId)
      if (sourceKey === key) {
        linkModeSource.value = null
        renderScene()
        return
      }
      createFk(linkModeSource.value.tableId, linkModeSource.value.columnId, table.id, col.id)
      linkModeSource.value = null
      renderScene()
      return
    }

    selectedTableId.value = table.id
    selectedColumnKey.value = key
    selectedFkId.value = ''
    renderScene()
  })

  group.on('dragstart', () => {
    selectedTableId.value = table.id
    selectedFkId.value = ''
  })

  group.on('dragend', () => {
    table.x = Math.max(0, Math.round(group.x()))
    table.y = Math.max(0, Math.round(group.y()))
    commit()
    renderScene()
    positionToolbarNearSelection()
  })

  objectGroup.add(group)
  cullingNodes.push(group)
}

function renderScene() {
  if (!canvasApi.value) return
  const Konva = canvasApi.value.getKonva()
  const layers = canvasApi.value.getLayers()
  if (!Konva || !layers?.objectGroup) return

  const objectGroup = layers.objectGroup
  objectGroup.destroyChildren()
  const cullingNodes = []

  const tableById = new Map(local.value.tables.map((table) => [table.id, table]))

  const routedFkLines = []
  if (props.showFk) {
    for (const fk of local.value.fkLinks) {
      const fromTable = tableById.get(fk.fromTableId)
      const toTable = tableById.get(fk.toTableId)
      if (!fromTable || !toTable) continue

      const [fromSide, toSide] = chooseAnchorSides(fromTable, fk.fromColumnId, toTable, fk.toColumnId)
      const fromAnchor = getColumnAnchor(fromTable, fk.fromColumnId, fromSide)
      const toAnchor = getColumnAnchor(toTable, fk.toColumnId, toSide)
      if (!fromAnchor || !toAnchor) continue

      const obstacles = local.value.tables
        .filter((table) => table.id !== fromTable.id && table.id !== toTable.id)
        .map((table) => getTableRect(table, LINK_OBSTACLE_PADDING))
      const rawPath = routePolyline(fromAnchor, toAnchor, obstacles)
      const path = ensureCurveWaypoint(rawPath)
      const points = path.flatMap((point) => [point.x, point.y])
      routedFkLines.push({ fk, points })

      const hit = new Konva.Line({
        points,
        stroke: 'transparent',
        strokeWidth: 14,
      })
      hit.on('click tap', (evt) => {
        evt.cancelBubble = true
        selectedFkId.value = fk.id
        selectedTableId.value = ''
        selectedColumnKey.value = ''
        renderScene()
      })
      hit.on('contextmenu', (evt) => {
        evt.evt.preventDefault()
        local.value.fkLinks = local.value.fkLinks.filter((item) => item.id !== fk.id)
        if (selectedFkId.value === fk.id) selectedFkId.value = ''
        commit()
        renderScene()
      })
      objectGroup.add(hit)
      cullingNodes.push(hit)
    }
  }

  for (const table of local.value.tables) {
    drawTable(Konva, objectGroup, table, cullingNodes)
  }

  for (const { fk, points } of routedFkLines) {
    const line = new Konva.Arrow({
      points,
      stroke: selectedFkId.value === fk.id ? '#0a84ff' : '#6783ad',
      fill: selectedFkId.value === fk.id ? '#0a84ff' : '#6783ad',
      strokeWidth: selectedFkId.value === fk.id ? 2.8 : 2.2,
      pointerLength: 10,
      pointerWidth: 10,
      tension: LINK_CURVE_TENSION,
      lineCap: 'round',
      lineJoin: 'round',
      listening: false,
    })
    objectGroup.add(line)
    cullingNodes.push(line)
  }

  canvasApi.value.setCullingNodes(cullingNodes)
  canvasApi.value.getStage()?.batchDraw()
}

function centerCanvasOnInitialLoad() {
  if (hasAutoCentered.value || !canvasApi.value) return
  const stage = canvasApi.value.getStage?.()
  if (!stage || typeof canvasApi.value.setViewport !== 'function') return

  let centerX = LOGICAL_CENTER.x
  let centerY = LOGICAL_CENTER.y
  if (local.value.tables.length) {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const table of local.value.tables) {
      const metrics = getTableMetrics(table)
      minX = Math.min(minX, table.x)
      minY = Math.min(minY, table.y)
      maxX = Math.max(maxX, table.x + metrics.rowWidth)
      maxY = Math.max(maxY, table.y + metrics.totalHeight)
    }
    centerX = (minX + maxX) / 2
    centerY = (minY + maxY) / 2
  }

  canvasApi.value.setViewport({
    scale: 1,
    x: (stage.width() / 2) - centerX,
    y: (stage.height() / 2) - centerY,
  }, { throttle: false })
  hasAutoCentered.value = true
}

function onKonvaReady(api) {
  canvasApi.value = api
  renderScene()
  centerCanvasOnInitialLoad()
  positionToolbarNearSelection()
}

function onKeyDown(event) {
  const target = event.target
  if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"], select')) return
  if (event.key === 'Escape') {
    linkModeSource.value = null
    renderScene()
    return
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault()
    removeSelected()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', positionToolbarNearSelection)
  positionToolbarNearSelection()
})

onBeforeUnmount(() => {
  stopFloatingDrag()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('resize', positionToolbarNearSelection)
})

watch([selectedTableId, selectedColumnKey], ([tId, cKey], [prevT, prevC]) => {
  if ((tId && tId !== prevT) || (cKey && cKey !== prevC)) positionToolbarNearSelection()
})
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
        <button class="toolbar-btn" :disabled="!selectedTable" @click="addColumn(selectedTable?.id)">新增欄位</button>
        <button v-if="showFk" class="toolbar-btn" :disabled="!selectedColumn" @click="toggleLinkMode">
          {{ linkModeSource ? '取消新增連線' : '新增連線' }}
        </button>
        <button class="toolbar-btn danger" :disabled="!selectedTable && !selectedColumn && !selectedFkId" @click="removeSelected">
          刪除選取
        </button>
      </div>
    </header>

    <main ref="canvasPanelRef" class="table-editor-main">
      <KonvaHugeCanvas
        class="konva-root"
        @ready="onKonvaReady"
        @logical-click="onLogicalClick"
        @viewport-change="onViewportChange"
      />

      <div
        v-if="selectedTable || selectedColumn"
        class="floating-toolbar"
        :style="{ left: `${floatingToolbar.x}px`, top: `${floatingToolbar.y}px` }"
      >
        <div class="floating-toolbar-head" @mousedown="startFloatingDrag">工具列（可拖動）</div>
        <div class="floating-toolbar-body">
          <template v-if="selectedColumn">
            <input class="floating-input" v-model="selectedColumn.column.name" @input="onFieldInput" placeholder="欄位名稱" />
            <label class="floating-flag"><input type="checkbox" v-model="selectedColumn.column.pk" @change="onFieldInput" /> PK 主鍵</label>
            <label class="floating-flag"><input type="checkbox" v-model="selectedColumn.column.fk" @change="onFieldInput" /> FK 外鍵</label>
            <label v-if="mode === 'physical'" class="floating-flag"><input type="checkbox" v-model="selectedColumn.column.nullable" @change="onFieldInput" /> NULL</label>
            <input v-if="mode === 'physical'" class="floating-input" v-model="selectedColumn.column.dataType" @input="onFieldInput" placeholder="資料類型" />
            <button v-if="showFk" class="floating-btn" :class="{ active: linkModeSource }" @click="toggleLinkMode">
              {{ linkModeSource ? '取消新增連線' : '→ 新增連線' }}
            </button>
            <button class="floating-btn" @click="addColumn(selectedColumn.table.id)">＋ 新增欄位</button>
            <button class="floating-btn danger" @click="removeColumn(selectedColumn.table.id, selectedColumn.column.id)">刪除欄位</button>
          </template>
          <template v-else-if="selectedTable">
            <input class="floating-input" v-model="selectedTable.name" @input="onFieldInput" placeholder="資料表名稱" />
            <button class="floating-btn" @click="addColumn(selectedTable.id)">＋ 新增欄位</button>
            <button class="floating-btn danger" @click="removeTable(selectedTable.id)">刪除資料表</button>
          </template>
        </div>
      </div>
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
  flex-wrap: wrap;
}

.toolbar-btn {
  border: 1px solid var(--mac-border);
  background: var(--mac-surface);
  border-radius: 9px;
  padding: 7px 10px;
  font-size: 12px;
  cursor: pointer;
}

.toolbar-btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.toolbar-btn.danger {
  color: #c4453c;
  border-color: rgba(255, 69, 58, 0.35);
  background: rgba(255, 69, 58, 0.08);
}

.table-editor-main {
  min-height: 0;
  flex: 1;
  position: relative;
}

.konva-root {
  height: 100%;
  min-height: 560px;
}

.floating-toolbar {
  position: absolute;
  z-index: 12;
  width: 176px;
  border: 1px solid var(--mac-border);
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
}

.floating-toolbar-head {
  cursor: move;
  user-select: none;
  border-bottom: 1px solid var(--mac-border);
  background: #eef2f9;
  color: #4a5a74;
  border-radius: 10px 10px 0 0;
  font-size: 11px;
  font-weight: 700;
  padding: 6px 8px;
}

.floating-toolbar-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
}

.floating-input {
  width: 100%;
  border: 1px solid var(--mac-border);
  border-radius: 7px;
  padding: 5px 8px;
  font-size: 12px;
  box-sizing: border-box;
}

.floating-flag {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
}

.floating-btn {
  width: 100%;
  border: 1px solid var(--mac-border);
  background: #fff;
  border-radius: 7px;
  min-height: 28px;
  font-size: 12px;
  text-align: left;
  padding: 0 8px;
  cursor: pointer;
}

.floating-btn.active {
  border-color: rgba(255, 149, 0, 0.6);
  background: rgba(255, 149, 0, 0.1);
  color: #b45309;
}

.floating-btn.danger {
  color: #c4453c;
  border-color: rgba(255, 69, 58, 0.35);
}

.fk-panel h3 {
  margin: 0;
  font-size: 13px;
}

.fk-panel input {
  border: 1px solid var(--mac-border);
  border-radius: 8px;
  padding: 7px 8px;
  font-size: 13px;
}

.muted {
  margin: 0;
  font-size: 12px;
  color: var(--mac-muted);
}

@media (max-width: 980px) {
  .table-editor-main {
    grid-template-columns: 1fr;
  }
}
</style>
