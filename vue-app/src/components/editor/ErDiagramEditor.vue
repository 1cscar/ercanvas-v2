<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import KonvaHugeCanvas from '@/components/editor/konva/KonvaHugeCanvas.vue'

const props = defineProps({
  content: {
    type: Object,
    default: () => ({ nodes: [], edges: [], nextId: 1 }),
  },
})

const emit = defineEmits(['update:content'])

const ELEMENTS = [
  { type: 'entity', label: '實體' },
  { type: 'relationship', label: '關係' },
  { type: 'attribute', label: '屬性' },
  { type: 'weak-entity', label: '實體關聯' },
]

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeNode(node) {
  const base = {
    id: '',
    type: 'entity',
    label: '',
    x: 80,
    y: 80,
    w: 150,
    h: 84,
    fontSize: 14,
    fontColor: '#1f2937',
    fontWeight: '600',
    fontFamily: 'Noto Sans TC',
    fontUnderline: false,
  }
  const next = { ...base, ...(node || {}) }
  if (!next.id) next.id = `n_${Math.random().toString(36).slice(2, 8)}`
  next.w = Math.max(90, Number(next.w) || base.w)
  next.h = Math.max(56, Number(next.h) || base.h)
  if (next.type === 'relationship') {
    const side = Math.max(90, Math.round(Math.max(next.w, next.h)))
    next.w = side
    next.h = side
  }
  next.x = Number(next.x) || 0
  next.y = Number(next.y) || 0
  return next
}

function normalizeEdge(edge) {
  const base = {
    id: '',
    from: '',
    to: '',
  }
  const next = { ...base, ...(edge || {}) }
  if (!next.id) next.id = `e_${Math.random().toString(36).slice(2, 8)}`
  return next
}

function normalizeContent(content) {
  const raw = content || {}
  const nodes = Array.isArray(raw.nodes) ? raw.nodes.map(normalizeNode) : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(raw.edges)
    ? raw.edges
        .map(normalizeEdge)
        .filter((edge) => edge.from && edge.to && edge.from !== edge.to && nodeIds.has(edge.from) && nodeIds.has(edge.to))
    : []
  const nextId = Number.isFinite(raw.nextId) ? Number(raw.nextId) : (nodes.length + edges.length + 1)
  return { nodes, edges, nextId }
}

const local = ref(normalizeContent(props.content))
const canvasApi = ref(null)
const canvasPanelRef = ref(null)
const canvasToolbarRef = ref(null)
const canvasStageRef = ref(null)
const inlineEditorRef = ref(null)

const selectedNodeId = ref('')
const selectedEdgeId = ref('')
const paletteType = ref('entity')
const queuedPlacementType = ref('')
const toolMode = ref('select') // select | connect | append
const connectSourceId = ref('')
const appendSourceId = ref('')
const floatingToolbar = ref({ x: Math.max(12, window.innerWidth - 200), y: 72 })
let floatingDragState = null
let lastNodeClick = { id: '', at: 0 }

const viewport = ref({ scale: 1, x: 24, y: 24 })
const editingNodeId = ref('')
const editingLabelDraft = ref('')
const hasAutoCentered = ref(false)

function onViewportChange(vp) {
  viewport.value = { scale: vp.scale, x: vp.position.x, y: vp.position.y }
  if (selectedNode.value) positionToolbarNearNode(selectedNode.value)
}

function positionToolbarNearNode(node) {
  const panel = canvasPanelRef.value
  if (!panel || !node) return
  const { scale, x: vx, y: vy } = viewport.value
  const topBarHeight = (canvasToolbarRef.value?.offsetHeight || 46) + 8
  const toolbarWidth = 176
  const toolbarHeight = 248
  const nodeRight = node.x * scale + vx + node.w * scale + 8
  const nodeTop = node.y * scale + vy + Math.max(0, (node.h * scale - toolbarHeight) / 2)
  const panelW = panel.clientWidth
  const panelH = panel.clientHeight
  floatingToolbar.value.x = Math.max(8, Math.min(nodeRight, panelW - toolbarWidth - 8))
  floatingToolbar.value.y = Math.max(topBarHeight, Math.min(nodeTop, panelH - toolbarHeight - 8))
}

const selectedNode = computed(() => local.value.nodes.find((n) => n.id === selectedNodeId.value) || null)
const editingNode = computed(() => local.value.nodes.find((n) => n.id === editingNodeId.value) || null)

const inlineEditorStyle = computed(() => {
  const node = editingNode.value
  if (!node) return {}

  const scale = viewport.value.scale || 1
  const width = Math.max(120, Math.round(node.w * scale * 0.9))
  const height = Math.max(34, Math.round(node.h * scale * 0.42))
  const left = node.x * scale + viewport.value.x + Math.max(0, (node.w * scale - width) / 2)
  const top = node.y * scale + viewport.value.y + Math.max(0, (node.h * scale - height) / 2)

  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    minHeight: `${height}px`,
    fontSize: `${Math.max(12, Math.round((Number(node.fontSize) || 14) * scale))}px`,
    fontWeight: node.fontWeight === '700' ? '700' : '400',
    textDecoration: node.fontUnderline ? 'underline' : 'none',
  }
})

const modeHint = computed(() => {
  if (toolMode.value === 'connect') {
    if (connectSourceId.value) return '連線模式：點另一個元素建立連線，再點同一元素可取消。'
    return '連線模式：先點一個來源元素。'
  }
  if (toolMode.value === 'append') {
    if (appendSourceId.value) return '新增元素模式：點空白處放置新元素，會自動連線至來源。'
    return '新增元素模式：先點來源元素。'
  }
  if (queuedPlacementType.value) return `待放置：${elementLabel(queuedPlacementType.value)}，點擊畫布空白處。`
  return '選取模式：可拖曳元素與刪除元素/連線。'
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

function elementLabel(type) {
  return ELEMENTS.find((item) => item.type === type)?.label || type
}

function commit() {
  emit('update:content', deepClone(local.value))
}

function syncSelection() {
  if (selectedNodeId.value && !local.value.nodes.some((node) => node.id === selectedNodeId.value)) {
    selectedNodeId.value = ''
  }
  if (selectedEdgeId.value && !local.value.edges.some((edge) => edge.id === selectedEdgeId.value)) {
    selectedEdgeId.value = ''
  }
  if (connectSourceId.value && !local.value.nodes.some((node) => node.id === connectSourceId.value)) {
    connectSourceId.value = ''
  }
  if (appendSourceId.value && !local.value.nodes.some((node) => node.id === appendSourceId.value)) {
    appendSourceId.value = ''
  }
}

function nextId(prefix) {
  const id = `${prefix}${local.value.nextId}`
  local.value.nextId += 1
  return id
}

function createNode(type, x, y) {
  const shapeMap = {
    entity: { label: '', w: 156, h: 86 },
    relationship: { label: '', w: 120, h: 120 },
    attribute: { label: '', w: 132, h: 78 },
    'weak-entity': { label: '', w: 156, h: 86 },
  }
  const shape = shapeMap[type] || shapeMap.entity
  const node = normalizeNode({
    id: nextId('n'),
    type,
    label: shape.label,
    x: Math.round(x - shape.w / 2),
    y: Math.round(y - shape.h / 2),
    w: shape.w,
    h: shape.h,
  })
  local.value.nodes.push(node)
  return node
}

function cloneSelectedNode() {
  if (!selectedNode.value) return
  const source = selectedNode.value
  const clone = normalizeNode({
    ...deepClone(source),
    id: nextId('n'),
    x: source.x + 24,
    y: source.y + 24,
  })
  local.value.nodes.push(clone)
  selectedNodeId.value = clone.id
  selectedEdgeId.value = ''
  commit()
  renderScene()
}

function quickAddLinked(type) {
  if (!type) return
  if (!selectedNode.value) return
  const source = selectedNode.value
  const center = nodeCenter(source)
  const next = createNode(type, center.x + source.w / 2 + 110, center.y)
  const edge = createEdge(source.id, next.id)
  selectedNodeId.value = next.id
  selectedEdgeId.value = edge?.id || ''
  toolMode.value = 'select'
  connectSourceId.value = ''
  appendSourceId.value = ''
  queuedPlacementType.value = ''
  commit()
  renderScene()
}

function setSelectedFontSize(nextSize) {
  if (!selectedNode.value) return
  selectedNode.value.fontSize = clamp(Math.round(Number(nextSize) || 14), 10, 72)
  commit()
  renderScene()
}

function toggleSelectedUnderline() {
  if (!selectedNode.value) return
  selectedNode.value.fontUnderline = !selectedNode.value.fontUnderline
  commit()
  renderScene()
}

function openInlineEditor(nodeId) {
  const node = local.value.nodes.find((item) => item.id === nodeId)
  if (!node) return
  selectedNodeId.value = nodeId
  selectedEdgeId.value = ''
  editingNodeId.value = nodeId
  editingLabelDraft.value = node.label || ''
  renderScene()
}

function commitInlineEditor() {
  if (!editingNode.value) return
  editingNode.value.label = editingLabelDraft.value.trim()
  editingNodeId.value = ''
  commit()
  renderScene()
}

function cancelInlineEditor() {
  editingNodeId.value = ''
  editingLabelDraft.value = ''
  renderScene()
}

function changeSelectedType(type) {
  if (!selectedNode.value) return
  selectedNode.value.type = type
  if (type === 'relationship') {
    const side = Math.max(90, Math.round(Math.max(selectedNode.value.w, selectedNode.value.h)))
    selectedNode.value.w = side
    selectedNode.value.h = side
  }
  commit()
  renderScene()
}

function createEdge(from, to) {
  if (!from || !to || from === to) return null
  const exists = local.value.edges.some((edge) => (
    (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from)
  ))
  if (exists) return null
  const edge = normalizeEdge({
    id: nextId('e'),
    from,
    to,
  })
  local.value.edges.push(edge)
  return edge
}

function removeSelected() {
  if (selectedEdgeId.value) {
    local.value.edges = local.value.edges.filter((edge) => edge.id !== selectedEdgeId.value)
    selectedEdgeId.value = ''
    commit()
    renderScene()
    return
  }
  if (selectedNodeId.value) {
    const nodeId = selectedNodeId.value
    local.value.nodes = local.value.nodes.filter((node) => node.id !== nodeId)
    local.value.edges = local.value.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId)
    selectedNodeId.value = ''
    selectedEdgeId.value = ''
    if (connectSourceId.value === nodeId) connectSourceId.value = ''
    if (appendSourceId.value === nodeId) appendSourceId.value = ''
    commit()
    renderScene()
  }
}

function updateSelectedField(field, value) {
  if (!selectedNode.value) return
  if (field === 'w' || field === 'h') {
    const min = field === 'w' ? 90 : 56
    const nextSize = Math.max(min, Number(value) || min)
    if (selectedNode.value.type === 'relationship') {
      const side = Math.max(90, Math.round(nextSize))
      selectedNode.value.w = side
      selectedNode.value.h = side
    } else {
      selectedNode.value[field] = nextSize
    }
  } else {
    selectedNode.value[field] = value
  }
  commit()
  renderScene()
}

function onNodeClick(nodeId) {
  selectedEdgeId.value = ''
  if (toolMode.value === 'connect') {
    if (!connectSourceId.value) {
      connectSourceId.value = nodeId
      selectedNodeId.value = nodeId
      renderScene()
      return
    }
    if (connectSourceId.value === nodeId) {
      connectSourceId.value = ''
      toolMode.value = 'select'
      renderScene()
      return
    }
    const edge = createEdge(connectSourceId.value, nodeId)
    if (edge) {
      selectedEdgeId.value = edge.id
      commit()
    }
    connectSourceId.value = ''
    toolMode.value = 'select'
    renderScene()
    return
  }
  if (toolMode.value === 'append' && appendSourceId.value === nodeId) {
    appendSourceId.value = ''
    toolMode.value = 'select'
    renderScene()
    return
  }
  const now = Date.now()
  if (toolMode.value === 'select' && lastNodeClick.id === nodeId && now - lastNodeClick.at < 320) {
    lastNodeClick = { id: '', at: 0 }
    openInlineEditor(nodeId)
    return
  }
  lastNodeClick = { id: nodeId, at: now }
  selectedNodeId.value = nodeId
  renderScene()
}

function onLogicalClick(pos) {
  if (editingNodeId.value) {
    commitInlineEditor()
    return
  }
  lastNodeClick = { id: '', at: 0 }
  const placeType = queuedPlacementType.value || (toolMode.value === 'append' ? paletteType.value : '')
  if (placeType) {
    const node = createNode(placeType, pos.x, pos.y)
    selectedNodeId.value = node.id
    selectedEdgeId.value = ''
    if (toolMode.value === 'append' && appendSourceId.value) {
      const edge = createEdge(appendSourceId.value, node.id)
      if (edge) selectedEdgeId.value = edge.id
    }
    queuedPlacementType.value = ''
    commit()
    renderScene()
    return
  }
  selectedNodeId.value = ''
  selectedEdgeId.value = ''
  renderScene()
}

function queuePlacement(type) {
  paletteType.value = type
  queuedPlacementType.value = type
  toolMode.value = 'select'
  connectSourceId.value = ''
  appendSourceId.value = ''
}

function startConnectMode() {
  if (!selectedNodeId.value) return
  toolMode.value = 'connect'
  connectSourceId.value = selectedNodeId.value
  appendSourceId.value = ''
}

function startAppendMode() {
  if (!selectedNodeId.value) return
  toolMode.value = 'append'
  appendSourceId.value = selectedNodeId.value
  connectSourceId.value = ''
}

function cancelMode() {
  toolMode.value = 'select'
  connectSourceId.value = ''
  appendSourceId.value = ''
  queuedPlacementType.value = ''
  renderScene()
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function resetFloatingToolbar() {
  if (selectedNode.value) {
    positionToolbarNearNode(selectedNode.value)
  } else {
    const panel = canvasPanelRef.value
    const w = panel?.clientWidth || window.innerWidth
    floatingToolbar.value.x = Math.max(12, w - 196)
    floatingToolbar.value.y = 74
  }
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
  const maxX = Math.max(12, panel.clientWidth - 176)
  const maxY = Math.max(12, panel.clientHeight - 220)

  floatingToolbar.value.x = clamp(nextX, 12, maxX)
  floatingToolbar.value.y = clamp(nextY, 12, maxY)
}

function startFloatingDrag(event) {
  if (!selectedNode.value) return
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

function nodeCenter(node) {
  return {
    x: (Number(node.x) || 0) + (Number(node.w) || 0) / 2,
    y: (Number(node.y) || 0) + (Number(node.h) || 0) / 2,
  }
}

function rectangleBoundaryPoint(node, toward) {
  const center = nodeCenter(node)
  const halfW = Math.max(1, (Number(node.w) || 120) / 2)
  const halfH = Math.max(1, (Number(node.h) || 60) / 2)
  const dx = toward.x - center.x
  const dy = toward.y - center.y
  if (dx === 0 && dy === 0) return center
  const scale = Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH) || 1
  return {
    x: center.x + dx / scale,
    y: center.y + dy / scale,
  }
}

function ellipseBoundaryPoint(node, toward) {
  const center = nodeCenter(node)
  const rx = Math.max(1, (Number(node.w) || 120) / 2)
  const ry = Math.max(1, (Number(node.h) || 60) / 2)
  const dx = toward.x - center.x
  const dy = toward.y - center.y
  if (dx === 0 && dy === 0) return center
  const scale = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry))
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  }
}

function diamondBoundaryPoint(node, toward) {
  const center = nodeCenter(node)
  const halfW = Math.max(1, (Number(node.w) || 120) / 2)
  const halfH = Math.max(1, (Number(node.h) || 60) / 2)
  const dx = toward.x - center.x
  const dy = toward.y - center.y
  if (dx === 0 && dy === 0) return center
  const denom = (Math.abs(dx) / halfW) + (Math.abs(dy) / halfH)
  const scale = denom > 0 ? 1 / denom : 1
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  }
}

function nodeBoundaryPoint(node, toward) {
  if (node.type === 'attribute') return ellipseBoundaryPoint(node, toward)
  if (node.type === 'relationship') return diamondBoundaryPoint(node, toward)
  return rectangleBoundaryPoint(node, toward)
}

function buildNodeShape(Konva, node) {
  const isSelected = selectedNodeId.value === node.id
  const isSource = connectSourceId.value === node.id || appendSourceId.value === node.id
  const group = new Konva.Group({
    x: node.x,
    y: node.y,
    draggable: toolMode.value === 'select',
  })

  const strokeColor = isSource ? '#ff9500' : (isSelected ? '#0a84ff' : '#111111')

  if (node.type === 'attribute') {
    group.add(new Konva.Ellipse({
      x: node.w / 2,
      y: node.h / 2,
      radiusX: node.w / 2,
      radiusY: node.h / 2,
      fill: '#ffffff',
      stroke: strokeColor,
      strokeWidth: isSelected ? 2 : 1,
    }))
  } else if (node.type === 'relationship') {
    group.add(new Konva.Rect({
      x: node.w * 0.1464466,
      y: node.h * 0.1464466,
      width: node.w * 0.7071068,
      height: node.h * 0.7071068,
      fill: '#ffffff',
      stroke: strokeColor,
      strokeWidth: isSelected ? 2 : 1.4,
      rotation: 45,
      offsetX: (node.w * 0.7071068) / 2,
      offsetY: (node.h * 0.7071068) / 2,
    }))
  } else {
    group.add(new Konva.Rect({
      x: 0,
      y: 0,
      width: node.w,
      height: node.h,
      fill: '#ffffff',
      stroke: strokeColor,
      strokeWidth: isSelected ? 2 : 1,
    }))
    if (node.type === 'weak-entity') {
      group.add(new Konva.Line({
        points: [
          node.w / 2, 12,
          node.w - 10, node.h / 2,
          node.w / 2, node.h - 12,
          10, node.h / 2,
        ],
        closed: true,
        stroke: '#111111',
        strokeWidth: 1,
      }))
    }
  }

  group.add(new Konva.Text({
    x: 0,
    y: 0,
    width: node.w,
    height: node.h,
    text: node.label || '',
    fill: node.fontColor || '#1f2937',
    fontSize: Number(node.fontSize) || 14,
    fontStyle: node.fontWeight === '700' ? 'bold' : 'normal',
    fontFamily: node.fontFamily || 'Noto Sans TC',
    textDecoration: node.fontUnderline ? 'underline' : '',
    align: 'center',
    verticalAlign: 'middle',
    listening: false,
  }))

  group.on('click tap', (evt) => {
    evt.cancelBubble = true
    onNodeClick(node.id)
  })

  group.on('dblclick dbltap', (evt) => {
    evt.cancelBubble = true
    openInlineEditor(node.id)
  })

  group.on('dragstart', () => {
    selectedNodeId.value = node.id
    selectedEdgeId.value = ''
  })

  group.on('dragend', () => {
    node.x = Math.round(group.x())
    node.y = Math.round(group.y())
    commit()
    renderScene()
    positionToolbarNearNode(node)
  })

  return group
}

function renderScene() {
  if (!canvasApi.value) return
  const Konva = canvasApi.value.getKonva()
  const layers = canvasApi.value.getLayers()
  if (!Konva || !layers?.objectGroup) return

  const group = layers.objectGroup
  group.destroyChildren()

  const nodeMap = new Map(local.value.nodes.map((node) => [node.id, node]))
  const cullingNodes = []

  for (const edge of local.value.edges) {
    const from = nodeMap.get(edge.from)
    const to = nodeMap.get(edge.to)
    if (!from || !to) continue

    const fromCenter = nodeCenter(from)
    const toCenter = nodeCenter(to)
    const p1 = nodeBoundaryPoint(from, toCenter)
    const p2 = nodeBoundaryPoint(to, fromCenter)

    const hit = new Konva.Line({
      points: [p1.x, p1.y, p2.x, p2.y],
      stroke: 'transparent',
      strokeWidth: 14,
    })
    hit.on('click tap', (evt) => {
      evt.cancelBubble = true
      selectedEdgeId.value = edge.id
      selectedNodeId.value = ''
      renderScene()
    })
    hit.on('contextmenu', (evt) => {
      evt.evt.preventDefault()
      local.value.edges = local.value.edges.filter((item) => item.id !== edge.id)
      if (selectedEdgeId.value === edge.id) selectedEdgeId.value = ''
      commit()
      renderScene()
    })
    group.add(hit)
    cullingNodes.push(hit)

    const visible = new Konva.Line({
      points: [p1.x, p1.y, p2.x, p2.y],
      stroke: '#111111',
      strokeWidth: selectedEdgeId.value === edge.id ? 3 : 2.2,
      lineCap: 'round',
      listening: false,
    })
    group.add(visible)
    cullingNodes.push(visible)
  }

  for (const node of local.value.nodes) {
    const shape = buildNodeShape(Konva, node)
    group.add(shape)
    cullingNodes.push(shape)
  }

  canvasApi.value.setCullingNodes(cullingNodes)
  canvasApi.value.getStage()?.batchDraw()
}

function centerCanvasOnInitialLoad() {
  if (hasAutoCentered.value || !canvasApi.value) return
  canvasApi.value.fitToOverview?.({ maxScale: 1 })
  hasAutoCentered.value = true
}

function onKonvaReady(api) {
  canvasApi.value = api
  renderScene()
  centerCanvasOnInitialLoad()
}

function onKeyDown(event) {
  const target = event.target
  if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"], select')) return
  if (event.key === 'Escape') {
    if (editingNodeId.value) {
      cancelInlineEditor()
      return
    }
    cancelMode()
    return
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault()
    removeSelected()
  }
}

onMounted(() => {
  resetFloatingToolbar()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', resetFloatingToolbar)
})

onBeforeUnmount(() => {
  stopFloatingDrag()
  window.removeEventListener('resize', resetFloatingToolbar)
  window.removeEventListener('keydown', onKeyDown)
})

watch(editingNodeId, async (next) => {
  if (!next) return
  await nextTick()
  inlineEditorRef.value?.focus()
  inlineEditorRef.value?.select()
})

watch(
  () => selectedNodeId.value,
  (next) => {
    if (next) {
      const node = local.value.nodes.find((n) => n.id === next)
      if (node) positionToolbarNearNode(node)
    }
  },
)
</script>

<template>
  <section class="er-editor">
    <aside class="palette-sidebar">
      <button
        v-for="item in ELEMENTS"
        :key="item.type"
        class="palette-btn"
        :class="{ active: queuedPlacementType === item.type }"
        @click="queuePlacement(item.type)"
      >＋ {{ item.label }}</button>
      <button v-if="toolMode !== 'select' || queuedPlacementType" class="palette-btn esc-btn" @click="cancelMode">Esc</button>
    </aside>
    <main ref="canvasPanelRef" class="canvas-panel">
      <header ref="canvasToolbarRef" class="canvas-toolbar">
        <span class="mode-hint muted">{{ modeHint }}</span>
      </header>
      <div ref="canvasStageRef" class="canvas-stage">
        <KonvaHugeCanvas
          class="konva-root"
          @ready="onKonvaReady"
          @logical-click="onLogicalClick"
          @viewport-change="onViewportChange"
        />
        <div class="canvas-controls">
          <button class="canvas-control-btn" @mousedown.stop @click.stop="canvasApi?.zoomIn()">+</button>
          <button class="canvas-control-btn" @mousedown.stop @click.stop="canvasApi?.zoomOut()">-</button>
          <button class="canvas-control-btn" @mousedown.stop @click.stop="canvasApi?.fitToOverview()">全覽</button>
        </div>

        <div
          v-if="editingNode"
          class="inline-text-editor"
          :style="inlineEditorStyle"
        >
          <input
            ref="inlineEditorRef"
            v-model="editingLabelDraft"
            class="inline-text-input"
            @blur="commitInlineEditor"
            @keydown.enter.prevent="commitInlineEditor"
            @keydown.esc.prevent="cancelInlineEditor"
          />
        </div>

        <div
          v-if="selectedNode"
          class="floating-toolbar"
          :style="{ left: `${floatingToolbar.x}px`, top: `${floatingToolbar.y}px` }"
        >
          <div class="floating-toolbar-head" @mousedown="startFloatingDrag">
            工具列（可拖動）
          </div>
          <div class="floating-toolbar-body">
            <input
              class="floating-input"
              placeholder="元素名稱"
              :value="selectedNode.label"
              @input="updateSelectedField('label', $event.target.value)"
            />
            <select class="toolbar-select" @change="quickAddLinked($event.target.value); $event.target.value = ''">
              <option value="">＋ 新增元素</option>
              <option value="entity">實體</option>
              <option value="attribute">屬性</option>
              <option value="relationship">關係</option>
              <option value="weak-entity">實體關聯</option>
            </select>
          <button class="floating-btn" @click="startConnectMode">→ 連線</button>
          <div class="floating-inline-tools">
            <button class="floating-mini-btn" @click="setSelectedFontSize((selectedNode?.fontSize || 14) - 2)">A-</button>
            <input
              class="floating-mini-input"
              type="number"
              min="10"
              max="72"
              :value="selectedNode?.fontSize || 14"
              @change="setSelectedFontSize($event.target.value)"
            />
            <button class="floating-mini-btn" @click="setSelectedFontSize((selectedNode?.fontSize || 14) + 2)">A+</button>
            <button class="floating-mini-btn" :class="{ active: selectedNode?.fontUnderline }" @click="toggleSelectedUnderline">底線</button>
          </div>
          <button class="floating-btn" @click="cloneSelectedNode">⎘ 複製</button>
          <button class="floating-btn danger" @click="removeSelected">刪除</button>
            <select
              class="toolbar-select"
              :value="selectedNode.type"
              @change="changeSelectedType($event.target.value)"
            >
              <option value="entity">更改：實體</option>
              <option value="attribute">更改：屬性</option>
              <option value="relationship">更改：關係</option>
              <option value="weak-entity">更改：實體關聯</option>
            </select>
          </div>
        </div>
      </div>
    </main>
  </section>
</template>

<style scoped>
.er-editor {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px;
  min-height: 0;
  height: 100%;
}

.palette-sidebar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 6px;
  border: 1px solid var(--mac-border);
  border-radius: 12px;
  background: var(--mac-surface-strong);
  overflow: hidden;
}

.palette-btn {
  border: 1px solid var(--mac-border);
  background: var(--mac-surface);
  border-radius: 8px;
  padding: 8px 4px;
  font-size: 11px;
  cursor: pointer;
  text-align: center;
  line-height: 1.3;
  word-break: keep-all;
}

.palette-btn.active {
  border-color: rgba(10, 132, 255, 0.68);
  color: #0a5ed8;
  background: rgba(10, 132, 255, 0.12);
}

.palette-btn.esc-btn {
  color: #888;
  font-size: 10px;
  margin-top: auto;
}

.canvas-panel {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
}

.canvas-toolbar {
  border: 1px solid var(--mac-border);
  border-radius: 10px;
  background: var(--mac-surface-strong);
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mode-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-stage {
  position: relative;
  min-height: 0;
  flex: 1;
}

.canvas-controls {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 20;
  display: flex;
  gap: 6px;
  pointer-events: all;
}

.canvas-control-btn {
  height: 28px;
  min-width: 28px;
  border: 1px solid var(--mac-border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.95);
  color: #344054;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  padding: 0 8px;
}

.canvas-control-btn:hover {
  background: #fff;
  border-color: #c2ccdc;
}

.konva-root {
  flex: 1;
  min-height: 520px;
}

.muted {
  margin: 0;
  font-size: 12px;
  color: var(--mac-muted);
}

.floating-toolbar {
  position: absolute;
  z-index: 12;
  width: 168px;
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

.floating-btn,
.toolbar-select {
  width: 100%;
  border: 1px solid var(--mac-border);
  background: #fff;
  border-radius: 7px;
  min-height: 28px;
  font-size: 12px;
  text-align: left;
  padding: 0 8px;
}

.floating-inline-tools {
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  gap: 6px;
}

.floating-mini-btn,
.floating-mini-input {
  border: 1px solid var(--mac-border);
  background: #fff;
  border-radius: 7px;
  min-height: 28px;
  font-size: 12px;
}

.floating-mini-btn {
  cursor: pointer;
}

.floating-mini-btn.active {
  border-color: rgba(10, 132, 255, 0.55);
  background: rgba(10, 132, 255, 0.12);
  color: #0a5ed8;
}

.floating-mini-input {
  width: 100%;
  text-align: center;
  padding: 0 4px;
}

.floating-inline-tools .floating-mini-btn:last-child {
  grid-column: 1 / -1;
}

.floating-btn {
  cursor: pointer;
}

.floating-btn.danger {
  color: #c4453c;
  border-color: rgba(255, 69, 58, 0.35);
}

.floating-input {
  width: 100%;
  border: 1px solid var(--mac-border);
  border-radius: 7px;
  padding: 5px 8px;
  font-size: 12px;
  box-sizing: border-box;
}

.inline-text-editor {
  position: absolute;
  z-index: 14;
}

.inline-text-input {
  width: 100%;
  min-height: inherit;
  border: 1px solid rgba(10, 132, 255, 0.45);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.98);
  color: #111827;
  text-align: center;
  padding: 6px 10px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.14);
  box-sizing: border-box;
}
</style>
