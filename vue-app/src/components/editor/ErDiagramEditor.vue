<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

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

const FONT_FAMILIES = [
  'Noto Sans TC',
  'PingFang TC',
  'Microsoft JhengHei',
  'Arial',
  'monospace',
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
  next.x = Math.max(0, Number(next.x) || 0)
  next.y = Math.max(0, Number(next.y) || 0)
  next.fontSize = Math.max(10, Math.min(40, Number(next.fontSize) || base.fontSize))
  next.fontColor = String(next.fontColor || base.fontColor)
  next.fontWeight = next.fontWeight === '700' ? '700' : '600'
  next.fontFamily = String(next.fontFamily || base.fontFamily)
  return next
}

function normalizeEdge(edge) {
  const base = {
    id: '',
    from: '',
    to: '',
    labelFrom: '',
    labelTo: '',
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
const canvasRef = ref(null)

const selectedNodeIds = ref([])
const selectedEdgeIds = ref([])
const activeNodeId = ref('')

const paletteType = ref('entity')
const queuedPlacementType = ref('')
const toolMode = ref('select') // select | connect | append
const connectSourceId = ref('')
const appendSourceId = ref('')

const dragState = ref(null)
const resizeState = ref(null)
const floatingToolbar = ref({ x: 18, y: 18 })
const toolbarDragState = ref(null)
const editingNodeId = ref('')
const toolbarMenu = ref({ addOpen: false, changeOpen: false })
const labelInputRefs = new Map()
const viewScale = ref(1)
const viewOffset = ref({ x: 12, y: 12 })
const pinchState = ref(null)
const panState = ref(null)
const suppressNextCanvasClick = ref(false)
const skipNextCanvasClick = ref(false)

const MIN_SCALE = 0.35
const MAX_SCALE = 2.6
// Keep scene size under Safari/GPU raster limits to avoid invisible nodes.
const BASE_SCENE_WIDTH = 11000
const BASE_SCENE_HEIGHT = 7000
const MAX_SCENE_WIDTH = 14000
const MAX_SCENE_HEIGHT = 10000
const GRID_SIZE = 24

watch(
  () => props.content,
  (value) => {
    local.value = normalizeContent(value)
    syncSelection()
  },
  { deep: true },
)

const selectedNodes = computed(() => (
  selectedNodeIds.value
    .map((id) => local.value.nodes.find((node) => node.id === id))
    .filter(Boolean)
))

const primarySelectedNode = computed(() => {
  if (activeNodeId.value) {
    const exact = local.value.nodes.find((node) => node.id === activeNodeId.value)
    if (exact) return exact
  }
  return selectedNodes.value[0] || null
})

const selectedEdgeSet = computed(() => new Set(selectedEdgeIds.value))

const edgeVisuals = computed(() => (
  local.value.edges
    .map((edge) => {
      const from = local.value.nodes.find((node) => node.id === edge.from)
      const to = local.value.nodes.find((node) => node.id === edge.to)
      if (!from || !to) return null
      const points = getEdgePoints(from, to)
      return { ...edge, ...points }
    })
    .filter(Boolean)
))

const sceneSize = computed(() => {
  const maxX = local.value.nodes.reduce((acc, node) => Math.max(acc, (Number(node.x) || 0) + (Number(node.w) || 0)), 0)
  const maxY = local.value.nodes.reduce((acc, node) => Math.max(acc, (Number(node.y) || 0) + (Number(node.h) || 0)), 0)
  return {
    width: Math.min(MAX_SCENE_WIDTH, Math.max(BASE_SCENE_WIDTH, Math.ceil(maxX + 260))),
    height: Math.min(MAX_SCENE_HEIGHT, Math.max(BASE_SCENE_HEIGHT, Math.ceil(maxY + 260))),
  }
})

const contentBounds = computed(() => {
  if (!local.value.nodes.length) {
    return { minX: 0, minY: 0, width: 960, height: 620 }
  }
  const minX = local.value.nodes.reduce((acc, node) => Math.min(acc, Number(node.x) || 0), Infinity)
  const minY = local.value.nodes.reduce((acc, node) => Math.min(acc, Number(node.y) || 0), Infinity)
  const maxX = local.value.nodes.reduce((acc, node) => Math.max(acc, (Number(node.x) || 0) + (Number(node.w) || 0)), 0)
  const maxY = local.value.nodes.reduce((acc, node) => Math.max(acc, (Number(node.y) || 0) + (Number(node.h) || 0)), 0)
  return {
    minX: Number.isFinite(minX) ? minX : 0,
    minY: Number.isFinite(minY) ? minY : 0,
    width: Math.max(360, Math.ceil(maxX - minX)),
    height: Math.max(260, Math.ceil(maxY - minY)),
  }
})

function positiveModulo(value, base) {
  if (!base) return 0
  const mod = value % base
  return mod < 0 ? mod + base : mod
}

const canvasGridStyle = computed(() => {
  const scaled = GRID_SIZE * viewScale.value
  const step = Math.max(8, Math.min(128, scaled))
  const offsetX = positiveModulo(viewOffset.value.x, step)
  const offsetY = positiveModulo(viewOffset.value.y, step)
  return {
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px`,
  }
})

const modeHint = computed(() => {
  if (toolMode.value === 'connect') {
    if (connectSourceId.value) return '連線模式：點另一個元素建立連線；再點同一個來源可取消。'
    return '連線模式：先點一個元素當來源。'
  }
  if (toolMode.value === 'append') {
    if (appendSourceId.value) return '新增元素模式：點空白處放置新元素，會自動連線到來源。'
    return '新增元素模式：先選一個來源元素。'
  }
  if (queuedPlacementType.value) return `待放置：${elementLabel(queuedPlacementType.value)}，請點畫布空白處。`
  return '選取模式：可拖移、Shift 多選、點線可單獨刪除。'
})

watch(
  () => primarySelectedNode.value?.id || '',
  () => {
    repositionFloatingToolbar()
  },
)

watch(
  () => viewScale.value,
  () => {
    repositionFloatingToolbar()
  },
)

watch(
  () => `${viewOffset.value.x}:${viewOffset.value.y}`,
  () => {
    repositionFloatingToolbar()
  },
)

watch(
  () => `${selectedNodeIds.value.join(',')}|${selectedEdgeIds.value.join(',')}`,
  () => {
    toolbarMenu.value = { addOpen: false, changeOpen: false }
  },
)

function elementLabel(type) {
  return ELEMENTS.find((item) => item.type === type)?.label || type
}

function commit() {
  emit('update:content', deepClone(local.value))
}

function clampScale(value) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value))
}

function getViewportAnchor(clientX, clientY) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return null
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
    rect,
  }
}

function getScenePointFromClient(clientX, clientY) {
  const anchor = getViewportAnchor(clientX, clientY)
  if (!anchor) return { x: 0, y: 0 }
  return {
    x: Math.max(0, (anchor.x - viewOffset.value.x) / viewScale.value),
    y: Math.max(0, (anchor.y - viewOffset.value.y) / viewScale.value),
  }
}

function zoomAtClient(clientX, clientY, factor) {
  const anchor = getViewportAnchor(clientX, clientY)
  if (!anchor) return

  const worldX = (anchor.x - viewOffset.value.x) / viewScale.value
  const worldY = (anchor.y - viewOffset.value.y) / viewScale.value
  const nextScale = clampScale(viewScale.value * factor)

  viewScale.value = nextScale
  viewOffset.value = {
    x: anchor.x - worldX * nextScale,
    y: anchor.y - worldY * nextScale,
  }
}

function zoomIn() {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  zoomAtClient(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.12)
}

function zoomOut() {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  zoomAtClient(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.9)
}

function fitView() {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  const bounds = contentBounds.value
  const fitW = Math.max(420, bounds.width + 280)
  const fitH = Math.max(300, bounds.height + 240)
  const nextScale = clampScale(Math.min(rect.width / fitW, rect.height / fitH, 1.35))
  viewScale.value = nextScale
  viewOffset.value = {
    x: Math.round((rect.width - bounds.width * nextScale) / 2 - bounds.minX * nextScale),
    y: Math.round((rect.height - bounds.height * nextScale) / 2 - bounds.minY * nextScale),
  }
}

function onCanvasWheel(event) {
  if (!event) return

  const isPinchZoom = event.ctrlKey || event.metaKey
  const isMouseWheel = event.deltaMode === 1

  if (isPinchZoom || isMouseWheel) {
    const factor = event.deltaY < 0 ? 1.1 : 0.9
    zoomAtClient(event.clientX, event.clientY, factor)
    return
  }

  // Trackpad two-finger scroll pans the canvas.
  viewOffset.value = {
    x: Math.round(viewOffset.value.x - event.deltaX),
    y: Math.round(viewOffset.value.y - event.deltaY),
  }
}

function placeQueuedNodeAtClient(clientX, clientY) {
  const placeType = queuedPlacementType.value || (toolMode.value === 'append' ? paletteType.value : '')
  if (!placeType) return false

  stopEditNode()
  toolbarMenu.value = { addOpen: false, changeOpen: false }

  const point = getScenePointFromClient(clientX, clientY)
  const x = Math.max(0, Math.min(sceneSize.value.width, point.x))
  const y = Math.max(0, Math.min(sceneSize.value.height, point.y))
  const node = createNode(placeType, x, y)
  setSingleNodeSelection(node.id)

  if (toolMode.value === 'append' && appendSourceId.value) {
    const edge = createEdge(appendSourceId.value, node.id)
    if (edge) selectedEdgeIds.value = [edge.id]
  }

  queuedPlacementType.value = ''
  commit()
  nextTick(() => {
    ensureNodeVisible(node.id)
  })
  return true
}

function onCanvasPointerDown(event) {
  if (!event) return
  if (event.button === 0) {
    const placed = placeQueuedNodeAtClient(event.clientX, event.clientY)
    if (placed) {
      // Safari/trackpad may still emit click after pointerdown.
      skipNextCanvasClick.value = true
      return
    }
  }
  beginCanvasPan(event)
}

function beginCanvasPan(event) {
  if (!event) return
  if (event.button !== 0 && event.button !== 1) return
  if (queuedPlacementType.value) return

  const target = event.target
  if (target instanceof HTMLElement) {
    if (target.closest('.node-card, .floating-toolbar')) return
    if (!target.closest('.er-canvas')) return
  }

  panState.value = {
    startX: event.clientX,
    startY: event.clientY,
    baseOffsetX: viewOffset.value.x,
    baseOffsetY: viewOffset.value.y,
    moved: false,
  }
  window.addEventListener('pointermove', onCanvasPanMove)
  window.addEventListener('pointerup', endCanvasPan, { once: true })
}

function onCanvasPanMove(event) {
  if (!panState.value) return
  const dx = event.clientX - panState.value.startX
  const dy = event.clientY - panState.value.startY
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panState.value.moved = true
  viewOffset.value = {
    x: Math.round(panState.value.baseOffsetX + dx),
    y: Math.round(panState.value.baseOffsetY + dy),
  }
}

function endCanvasPan() {
  window.removeEventListener('pointermove', onCanvasPanMove)
  if (panState.value?.moved) {
    // Only suppress selection-clear click after pan in normal select mode.
    suppressNextCanvasClick.value = !queuedPlacementType.value && toolMode.value === 'select'
  }
  panState.value = null
}

function touchDistance(touchA, touchB) {
  const dx = touchA.clientX - touchB.clientX
  const dy = touchA.clientY - touchB.clientY
  return Math.hypot(dx, dy)
}

function onCanvasTouchStart(event) {
  if (!event.touches || event.touches.length !== 2) return
  const anchor = getViewportAnchor(
    (event.touches[0].clientX + event.touches[1].clientX) / 2,
    (event.touches[0].clientY + event.touches[1].clientY) / 2,
  )
  if (!anchor) return
  pinchState.value = {
    startDistance: touchDistance(event.touches[0], event.touches[1]),
    worldX: (anchor.x - viewOffset.value.x) / viewScale.value,
    worldY: (anchor.y - viewOffset.value.y) / viewScale.value,
    baseScale: viewScale.value,
  }
}

function onCanvasTouchMove(event) {
  if (!pinchState.value || !event.touches || event.touches.length !== 2) return
  const anchor = getViewportAnchor(
    (event.touches[0].clientX + event.touches[1].clientX) / 2,
    (event.touches[0].clientY + event.touches[1].clientY) / 2,
  )
  if (!anchor) return
  const nextDistance = touchDistance(event.touches[0], event.touches[1])
  if (!nextDistance || !pinchState.value.startDistance) return
  const ratio = nextDistance / pinchState.value.startDistance
  const nextScale = clampScale(pinchState.value.baseScale * ratio)
  viewScale.value = nextScale
  viewOffset.value = {
    x: anchor.x - pinchState.value.worldX * nextScale,
    y: anchor.y - pinchState.value.worldY * nextScale,
  }
}

function onCanvasTouchEnd() {
  pinchState.value = null
}

function repositionFloatingToolbar() {
  const node = primarySelectedNode.value
  if (!node) return
  floatingToolbar.value = {
    x: Math.max(12, ((Number(node.x) || 0) + (Number(node.w) || 120)) * viewScale.value + viewOffset.value.x + 16),
    y: Math.max(12, (Number(node.y) || 0) * viewScale.value + viewOffset.value.y),
  }
}

function ensureNodeVisible(nodeId) {
  const node = local.value.nodes.find((item) => item.id === nodeId)
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!node || !rect) return

  const left = (Number(node.x) || 0) * viewScale.value + viewOffset.value.x
  const top = (Number(node.y) || 0) * viewScale.value + viewOffset.value.y
  const right = ((Number(node.x) || 0) + (Number(node.w) || 0)) * viewScale.value + viewOffset.value.x
  const bottom = ((Number(node.y) || 0) + (Number(node.h) || 0)) * viewScale.value + viewOffset.value.y

  const pad = 24
  const outOfView = (
    right < pad ||
    bottom < pad ||
    left > rect.width - pad ||
    top > rect.height - pad
  )
  if (!outOfView) return

  const centerX = (Number(node.x) || 0) + (Number(node.w) || 0) / 2
  const centerY = (Number(node.y) || 0) + (Number(node.h) || 0) / 2
  viewOffset.value = {
    x: Math.round(rect.width / 2 - centerX * viewScale.value),
    y: Math.round(rect.height / 2 - centerY * viewScale.value),
  }
}

function nextId(prefix) {
  const id = `${prefix}${local.value.nextId}`
  local.value.nextId += 1
  return id
}

function syncSelection() {
  const nodeIds = new Set(local.value.nodes.map((node) => node.id))
  const edgeIds = new Set(local.value.edges.map((edge) => edge.id))

  selectedNodeIds.value = selectedNodeIds.value.filter((id) => nodeIds.has(id))
  selectedEdgeIds.value = selectedEdgeIds.value.filter((id) => edgeIds.has(id))

  if (activeNodeId.value && !nodeIds.has(activeNodeId.value)) activeNodeId.value = ''
  if (connectSourceId.value && !nodeIds.has(connectSourceId.value)) connectSourceId.value = ''
  if (appendSourceId.value && !nodeIds.has(appendSourceId.value)) appendSourceId.value = ''
  if (toolMode.value === 'connect' && !connectSourceId.value) toolMode.value = 'select'
  if (toolMode.value === 'append' && !appendSourceId.value) toolMode.value = 'select'
}

function clearSelection() {
  selectedNodeIds.value = []
  selectedEdgeIds.value = []
  activeNodeId.value = ''
}

function setSingleNodeSelection(nodeId) {
  selectedNodeIds.value = [nodeId]
  selectedEdgeIds.value = []
  activeNodeId.value = nodeId
}

function toggleNodeSelection(nodeId) {
  const set = new Set(selectedNodeIds.value)
  if (set.has(nodeId)) {
    set.delete(nodeId)
    if (activeNodeId.value === nodeId) activeNodeId.value = ''
  } else {
    set.add(nodeId)
    activeNodeId.value = nodeId
  }
  selectedNodeIds.value = Array.from(set)
  selectedEdgeIds.value = []
}

function setSingleEdgeSelection(edgeId) {
  selectedEdgeIds.value = [edgeId]
  selectedNodeIds.value = []
  activeNodeId.value = ''
}

function toggleEdgeSelection(edgeId) {
  const set = new Set(selectedEdgeIds.value)
  if (set.has(edgeId)) set.delete(edgeId)
  else set.add(edgeId)
  selectedEdgeIds.value = Array.from(set)
  selectedNodeIds.value = []
  activeNodeId.value = ''
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
    x: Math.max(0, Math.round(x - shape.w / 2)),
    y: Math.max(0, Math.round(y - shape.h / 2)),
    w: shape.w,
    h: shape.h,
  })
  local.value.nodes.push(node)
  return node
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

function hasEdge(from, to) {
  return local.value.edges.some((edge) => (
    (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from)
  ))
}

function edgeExistsInList(edgeList, from, to) {
  return edgeList.some((edge) => (
    (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from)
  ))
}

function duplicateNodesAndEdges(nodeIds, options = {}) {
  const targets = nodeIds
    .map((id) => local.value.nodes.find((node) => node.id === id))
    .filter(Boolean)
  if (!targets.length) return { copies: [], edges: [] }

  const {
    dx = 36,
    dy = 30,
    copyExternalEdges = false,
  } = options

  const oldToNew = new Map()
  const copies = targets.map((source) => {
    const copy = normalizeNode({
      ...deepClone(source),
      id: nextId('n'),
      x: (Number(source.x) || 0) + dx,
      y: (Number(source.y) || 0) + dy,
    })
    oldToNew.set(source.id, copy.id)
    return copy
  })
  local.value.nodes.push(...copies)

  const targetIds = new Set(targets.map((node) => node.id))
  const newEdges = []
  for (const edge of local.value.edges) {
    const fromIn = targetIds.has(edge.from)
    const toIn = targetIds.has(edge.to)
    if (!fromIn && !toIn) continue

    if (fromIn && toIn) {
      const newFrom = oldToNew.get(edge.from)
      const newTo = oldToNew.get(edge.to)
      if (newFrom && newTo && newFrom !== newTo && !hasEdge(newFrom, newTo) && !edgeExistsInList(newEdges, newFrom, newTo)) {
        const nextEdge = normalizeEdge({
          ...deepClone(edge),
          id: nextId('e'),
          from: newFrom,
          to: newTo,
        })
        newEdges.push(nextEdge)
      }
      continue
    }

    if (!copyExternalEdges) continue

    if (fromIn && !toIn) {
      const newFrom = oldToNew.get(edge.from)
      if (newFrom && !hasEdge(newFrom, edge.to) && !edgeExistsInList(newEdges, newFrom, edge.to)) {
        const nextEdge = normalizeEdge({
          ...deepClone(edge),
          id: nextId('e'),
          from: newFrom,
          to: edge.to,
        })
        newEdges.push(nextEdge)
      }
      continue
    }

    if (!fromIn && toIn) {
      const newTo = oldToNew.get(edge.to)
      if (newTo && !hasEdge(edge.from, newTo) && !edgeExistsInList(newEdges, edge.from, newTo)) {
        const nextEdge = normalizeEdge({
          ...deepClone(edge),
          id: nextId('e'),
          from: edge.from,
          to: newTo,
        })
        newEdges.push(nextEdge)
      }
    }
  }

  if (newEdges.length) local.value.edges.push(...newEdges)
  return { copies, edges: newEdges }
}

function removeEdgesById(edgeIds) {
  if (!edgeIds.length) return
  const removeSet = new Set(edgeIds)
  local.value.edges = local.value.edges.filter((edge) => !removeSet.has(edge.id))
  selectedEdgeIds.value = selectedEdgeIds.value.filter((id) => !removeSet.has(id))
  commit()
}

function removeNodesById(nodeIds) {
  if (!nodeIds.length) return
  const removeSet = new Set(nodeIds)
  local.value.nodes = local.value.nodes.filter((node) => !removeSet.has(node.id))
  local.value.edges = local.value.edges.filter((edge) => !removeSet.has(edge.from) && !removeSet.has(edge.to))
  selectedNodeIds.value = []
  selectedEdgeIds.value = []
  activeNodeId.value = ''
  if (connectSourceId.value && removeSet.has(connectSourceId.value)) connectSourceId.value = ''
  if (appendSourceId.value && removeSet.has(appendSourceId.value)) appendSourceId.value = ''
  if (toolMode.value === 'connect' && !connectSourceId.value) toolMode.value = 'select'
  if (toolMode.value === 'append' && !appendSourceId.value) toolMode.value = 'select'
  commit()
}

function queuePlacement(type) {
  paletteType.value = type
  queuedPlacementType.value = type
  toolbarMenu.value = { addOpen: false, changeOpen: false }
}

function startConnectMode() {
  const source = primarySelectedNode.value
  if (!source) return
  toolMode.value = 'connect'
  connectSourceId.value = source.id
  appendSourceId.value = ''
  queuedPlacementType.value = ''
  toolbarMenu.value = { addOpen: false, changeOpen: false }
  selectedEdgeIds.value = []
}

function changeSelectedType(type) {
  if (!selectedNodeIds.value.length) return
  for (const nodeId of selectedNodeIds.value) {
    const node = local.value.nodes.find((item) => item.id === nodeId)
    if (!node) continue
    node.type = type
    if (type === 'relationship') {
      const side = Math.max(90, Math.round(Math.max(Number(node.w) || 0, Number(node.h) || 0)))
      node.w = side
      node.h = side
    }
  }
  toolbarMenu.value.changeOpen = false
  commit()
}

function duplicateSelection() {
  if (!selectedNodeIds.value.length) return
  stopEditNode()
  const { copies } = duplicateNodesAndEdges(selectedNodeIds.value, { dx: 36, dy: 30, copyExternalEdges: false })
  if (!copies.length) return
  selectedNodeIds.value = copies.map((node) => node.id)
  activeNodeId.value = copies[copies.length - 1]?.id || ''
  commit()
}

function startAppendMode() {
  const source = primarySelectedNode.value
  if (!source) return
  toolMode.value = 'append'
  appendSourceId.value = source.id
  connectSourceId.value = ''
  queuedPlacementType.value = ''
  toolbarMenu.value = { addOpen: false, changeOpen: false }
  selectedEdgeIds.value = []
}

function cancelMode() {
  toolMode.value = 'select'
  connectSourceId.value = ''
  appendSourceId.value = ''
  queuedPlacementType.value = ''
  toolbarMenu.value = { addOpen: false, changeOpen: false }
}

function toggleToolbarMenu(menuName) {
  if (menuName === 'addOpen') {
    toolbarMenu.value = {
      addOpen: !toolbarMenu.value.addOpen,
      changeOpen: false,
    }
    return
  }
  toolbarMenu.value = {
    addOpen: false,
    changeOpen: !toolbarMenu.value.changeOpen,
  }
}

function onToolbarAddType(type) {
  queuePlacement(type)
  toolbarMenu.value.addOpen = false
}

function setEditInputRef(nodeId, element) {
  if (element) labelInputRefs.set(nodeId, element)
  else labelInputRefs.delete(nodeId)
}

function startEditNode(nodeId) {
  editingNodeId.value = nodeId
  nextTick(() => {
    const input = labelInputRefs.get(nodeId)
    if (!input) return
    input.focus()
    if (typeof input.select === 'function') input.select()
  })
}

function stopEditNode() {
  editingNodeId.value = ''
}

function updatePrimaryNodeField(field, value) {
  if (!primarySelectedNode.value) return
  if (field === 'w' || field === 'h') {
    const min = field === 'w' ? 90 : 56
    const nextSize = Math.max(min, Number(value) || min)
    if (primarySelectedNode.value.type === 'relationship') {
      const side = Math.max(90, Math.round(nextSize))
      primarySelectedNode.value.w = side
      primarySelectedNode.value.h = side
    } else {
      primarySelectedNode.value[field] = nextSize
    }
  } else {
    primarySelectedNode.value[field] = value
  }
  commit()
}

function updateNodeLabel(nodeId, value) {
  const node = local.value.nodes.find((item) => item.id === nodeId)
  if (!node) return
  node.label = String(value)
  commit()
}

function applyTextStyle(patch) {
  if (!selectedNodeIds.value.length) return
  for (const nodeId of selectedNodeIds.value) {
    const node = local.value.nodes.find((item) => item.id === nodeId)
    if (!node) continue
    if (Object.prototype.hasOwnProperty.call(patch, 'fontSize')) {
      node.fontSize = Math.max(10, Math.min(40, Number(patch.fontSize) || 14))
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'fontColor')) {
      node.fontColor = String(patch.fontColor || '#1f2937')
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'fontWeight')) {
      node.fontWeight = patch.fontWeight === '700' ? '700' : '600'
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'fontFamily')) {
      node.fontFamily = String(patch.fontFamily || 'Noto Sans TC')
    }
  }
  commit()
}

function onCanvasClick(event) {
  if (skipNextCanvasClick.value) {
    skipNextCanvasClick.value = false
    return
  }

  const placeType = queuedPlacementType.value || (toolMode.value === 'append' ? paletteType.value : '')
  if (suppressNextCanvasClick.value) {
    suppressNextCanvasClick.value = false
    if (placeType) placeQueuedNodeAtClient(event.clientX, event.clientY)
    return
  }
  suppressNextCanvasClick.value = false

  if (!canvasRef.value) return
  stopEditNode()
  toolbarMenu.value = { addOpen: false, changeOpen: false }

  if (placeType) {
    placeQueuedNodeAtClient(event.clientX, event.clientY)
    return
  }

  if (!event.shiftKey) clearSelection()
}

function onNodeClick(node, event) {
  stopEditNode()

  if (toolMode.value === 'connect') {
    if (!connectSourceId.value) {
      connectSourceId.value = node.id
      setSingleNodeSelection(node.id)
      return
    }
    if (connectSourceId.value === node.id) {
      cancelMode()
      return
    }
    const edge = createEdge(connectSourceId.value, node.id)
    if (edge) {
      setSingleEdgeSelection(edge.id)
      commit()
    }
    cancelMode()
    return
  }

  if (toolMode.value === 'append' && appendSourceId.value === node.id) {
    cancelMode()
    return
  }

  if (event.shiftKey) {
    toggleNodeSelection(node.id)
    return
  }
  setSingleNodeSelection(node.id)
}

function onNodeDoubleClick(node) {
  if (toolMode.value !== 'select') return
  if (!selectedNodeIds.value.includes(node.id)) setSingleNodeSelection(node.id)
  startEditNode(node.id)
}

function onEdgeClick(edgeId, event) {
  if (event.shiftKey) {
    toggleEdgeSelection(edgeId)
    return
  }
  setSingleEdgeSelection(edgeId)
}

function onEdgeContextMenu(edgeId) {
  removeEdgesById([edgeId])
}

function beginDrag(node, event) {
  if (toolMode.value !== 'select') return
  if (event.button !== 0 && event.button !== 2) return
  stopEditNode()

  if (event.button === 2) {
    stopEditNode()
    setSingleNodeSelection(node.id)
    const { copies } = duplicateNodesAndEdges([node.id], {
      dx: 0,
      dy: 0,
      copyExternalEdges: true,
    })
    if (!copies.length) return
    const copy = copies[0]
    selectedNodeIds.value = [copy.id]
    activeNodeId.value = copy.id
    dragState.value = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      positions: { [copy.id]: { x: Number(copy.x) || 0, y: Number(copy.y) || 0 } },
      moved: false,
    }
    commit()
    window.addEventListener('pointermove', onGlobalPointerMove)
    window.addEventListener('pointerup', endPointerInteraction, { once: true })
    return
  }

  if (event.shiftKey) {
    toggleNodeSelection(node.id)
    return
  }

  if (!selectedNodeIds.value.includes(node.id)) setSingleNodeSelection(node.id)
  if (!selectedNodeIds.value.length) return

  dragState.value = {
    startClientX: event.clientX,
    startClientY: event.clientY,
    positions: selectedNodeIds.value.reduce((acc, nodeId) => {
      const current = local.value.nodes.find((item) => item.id === nodeId)
      if (current) acc[nodeId] = { x: Number(current.x) || 0, y: Number(current.y) || 0 }
      return acc
    }, {}),
    moved: false,
  }

  window.addEventListener('pointermove', onGlobalPointerMove)
  window.addEventListener('pointerup', endPointerInteraction, { once: true })
}

function beginResize(node, event) {
  if (event.button !== 0) return
  stopEditNode()
  resizeState.value = {
    nodeId: node.id,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startW: Number(node.w) || 150,
    startH: Number(node.h) || 84,
    moved: false,
  }

  if (!selectedNodeIds.value.includes(node.id)) setSingleNodeSelection(node.id)

  window.addEventListener('pointermove', onGlobalPointerMove)
  window.addEventListener('pointerup', endPointerInteraction, { once: true })
}

function onGlobalPointerMove(event) {
  if (dragState.value) {
    const dx = (event.clientX - dragState.value.startClientX) / viewScale.value
    const dy = (event.clientY - dragState.value.startClientY) / viewScale.value
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) dragState.value.moved = true
    for (const [nodeId, start] of Object.entries(dragState.value.positions)) {
      const node = local.value.nodes.find((item) => item.id === nodeId)
      if (!node) continue
      node.x = Math.max(0, Math.round(start.x + dx))
      node.y = Math.max(0, Math.round(start.y + dy))
    }
    repositionFloatingToolbar()
    return
  }

  if (resizeState.value) {
    const node = local.value.nodes.find((item) => item.id === resizeState.value.nodeId)
    if (!node) return
    const dw = (event.clientX - resizeState.value.startClientX) / viewScale.value
    const dh = (event.clientY - resizeState.value.startClientY) / viewScale.value
    if (Math.abs(dw) > 1 || Math.abs(dh) > 1) resizeState.value.moved = true
    if (node.type === 'relationship') {
      const side = Math.max(
        90,
        Math.round(Math.max(resizeState.value.startW + dw, resizeState.value.startH + dh)),
      )
      node.w = side
      node.h = side
    } else {
      node.w = Math.max(90, Math.round(resizeState.value.startW + dw))
      node.h = Math.max(56, Math.round(resizeState.value.startH + dh))
    }
    repositionFloatingToolbar()
  }
}

function endPointerInteraction() {
  window.removeEventListener('pointermove', onGlobalPointerMove)

  const moved = Boolean(
    (dragState.value && dragState.value.moved) ||
    (resizeState.value && resizeState.value.moved),
  )

  dragState.value = null
  resizeState.value = null
  if (moved) commit()
}

function beginToolbarDrag(event) {
  if (event.button !== 0) return
  toolbarDragState.value = {
    startX: event.clientX,
    startY: event.clientY,
    baseX: floatingToolbar.value.x,
    baseY: floatingToolbar.value.y,
  }
  window.addEventListener('pointermove', onToolbarPointerMove)
  window.addEventListener('pointerup', endToolbarDrag, { once: true })
}

function onToolbarPointerMove(event) {
  if (!toolbarDragState.value) return
  const dx = event.clientX - toolbarDragState.value.startX
  const dy = event.clientY - toolbarDragState.value.startY
  floatingToolbar.value = {
    x: Math.max(6, Math.round(toolbarDragState.value.baseX + dx)),
    y: Math.max(6, Math.round(toolbarDragState.value.baseY + dy)),
  }
}

function endToolbarDrag() {
  toolbarDragState.value = null
  window.removeEventListener('pointermove', onToolbarPointerMove)
}

function removeCurrentSelection() {
  if (selectedEdgeIds.value.length) {
    removeEdgesById(selectedEdgeIds.value)
    return
  }
  if (selectedNodeIds.value.length) {
    removeNodesById(selectedNodeIds.value)
  }
}

function isTypingTarget(target) {
  if (!target || !(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, [contenteditable="true"]'))
}

function onKeyDown(event) {
  if (isTypingTarget(event.target)) return

  if (event.key === 'Escape') {
    queuedPlacementType.value = ''
    cancelMode()
    return
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault()
    removeCurrentSelection()
    return
  }

  if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    zoomIn()
    return
  }

  if (event.key === '-') {
    event.preventDefault()
    zoomOut()
  }
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

function getEdgePoints(fromNode, toNode) {
  const fromCenter = nodeCenter(fromNode)
  const toCenter = nodeCenter(toNode)
  const p1 = nodeBoundaryPoint(fromNode, toCenter)
  const p2 = nodeBoundaryPoint(toNode, fromCenter)
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  nextTick(() => {
    fitView()
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('pointermove', onGlobalPointerMove)
  window.removeEventListener('pointermove', onToolbarPointerMove)
  window.removeEventListener('pointermove', onCanvasPanMove)
})
</script>

<template>
  <section class="er-editor">
    <aside class="tool-panel">
      <div class="tool-group">
        <h3>元素選單</h3>
        <div class="palette-list">
          <button
            v-for="item in ELEMENTS"
            :key="item.type"
            class="tool-btn palette-btn"
            :class="{ active: paletteType === item.type }"
            @click="queuePlacement(item.type)"
          >
            <span class="palette-icon" :class="`type-${item.type}`">
              <span v-if="item.type === 'weak-entity'" class="inner-diamond"></span>
            </span>
            <span>{{ item.label }}</span>
          </button>
        </div>
        <p class="muted">{{ modeHint }}</p>
      </div>

      <div class="tool-group" v-if="primarySelectedNode">
        <h3>元素屬性</h3>
        <label>文字</label>
        <input :value="primarySelectedNode.label" @input="updatePrimaryNodeField('label', $event.target.value)" />
        <label>寬度</label>
        <input
          type="number"
          min="90"
          :value="primarySelectedNode.w"
          @input="updatePrimaryNodeField('w', $event.target.value)"
        />
        <label>高度</label>
        <input
          type="number"
          min="56"
          :value="primarySelectedNode.h"
          @input="updatePrimaryNodeField('h', $event.target.value)"
        />
      </div>

      <div class="tool-group" v-if="selectedNodeIds.length">
        <h3>文字樣式（套用選取元素）</h3>
        <label>字型</label>
        <select
          :value="primarySelectedNode?.fontFamily || 'Noto Sans TC'"
          @change="applyTextStyle({ fontFamily: $event.target.value })"
        >
          <option v-for="family in FONT_FAMILIES" :key="family" :value="family">{{ family }}</option>
        </select>
        <label>字體大小</label>
        <input
          type="number"
          min="10"
          max="40"
          :value="primarySelectedNode?.fontSize || 14"
          @input="applyTextStyle({ fontSize: $event.target.value })"
        />
        <label>字體顏色</label>
        <input
          type="color"
          :value="primarySelectedNode?.fontColor || '#1f2937'"
          @input="applyTextStyle({ fontColor: $event.target.value })"
        />
        <label class="checkbox-row">
          <input
            type="checkbox"
            :checked="(primarySelectedNode?.fontWeight || '600') === '700'"
            @change="applyTextStyle({ fontWeight: $event.target.checked ? '700' : '600' })"
          />
          粗體
        </label>
      </div>
    </aside>

    <main class="canvas-panel">
      <header class="canvas-toolbar">
        <div class="zoom-controls">
          <button class="zoom-btn" @click="zoomOut">-</button>
          <button class="zoom-btn" @click="zoomIn">+</button>
          <button class="zoom-btn fit" @click="fitView">全覽</button>
          <span class="zoom-scale">{{ Math.round(viewScale * 100) }}%</span>
        </div>
      </header>

      <div
        ref="canvasRef"
        class="er-canvas"
        :class="{ panning: !!panState }"
        @pointerdown="onCanvasPointerDown"
        @click="onCanvasClick"
        @wheel.prevent="onCanvasWheel"
        @touchstart="onCanvasTouchStart"
        @touchmove.prevent="onCanvasTouchMove"
        @touchend="onCanvasTouchEnd"
        @touchcancel="onCanvasTouchEnd"
      >
        <div class="canvas-grid" :style="canvasGridStyle"></div>
        <div
          class="scene"
          :style="{
            width: `${sceneSize.width}px`,
            height: `${sceneSize.height}px`,
            transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${viewScale})`,
            transformOrigin: '0 0',
          }"
        >
          <svg class="edge-layer" :style="{ width: `${sceneSize.width}px`, height: `${sceneSize.height}px` }">
          <g v-for="edge in edgeVisuals" :key="edge.id">
            <line
              class="edge-hit"
              :x1="edge.x1"
              :y1="edge.y1"
              :x2="edge.x2"
              :y2="edge.y2"
              @click.stop="onEdgeClick(edge.id, $event)"
              @contextmenu.prevent.stop="onEdgeContextMenu(edge.id)"
            />
            <line
              class="edge-visible"
              :class="{ selected: selectedEdgeSet.has(edge.id) }"
              :x1="edge.x1"
              :y1="edge.y1"
              :x2="edge.x2"
              :y2="edge.y2"
            />
          </g>
          </svg>

          <div
            v-for="node in local.nodes"
            :key="node.id"
            class="node-card"
            :data-type="node.type"
            :class="{
              selected: selectedNodeIds.includes(node.id),
              source: connectSourceId === node.id || appendSourceId === node.id,
            }"
            :style="{
              left: `${node.x}px`,
              top: `${node.y}px`,
              width: `${node.w}px`,
              height: `${node.h}px`,
            }"
            @click.stop="onNodeClick(node, $event)"
            @dblclick.stop="onNodeDoubleClick(node)"
            @pointerdown.stop.prevent="beginDrag(node, $event)"
            @contextmenu.prevent.stop
          >
            <input
              v-if="editingNodeId === node.id"
              class="node-label-input editing"
              type="text"
              :style="{
                fontSize: `${node.fontSize}px`,
                color: node.fontColor,
                fontWeight: node.fontWeight,
                fontFamily: node.fontFamily,
              }"
              :value="node.label"
              :ref="(el) => setEditInputRef(node.id, el)"
              @pointerdown.stop
              @click.stop
              @input="updateNodeLabel(node.id, $event.target.value)"
              @blur="stopEditNode"
              @keydown.enter.exact.prevent="stopEditNode"
            />
            <div
              v-else
              class="node-label-display"
              :style="{
                fontSize: `${node.fontSize}px`,
                color: node.fontColor,
                fontWeight: node.fontWeight,
                fontFamily: node.fontFamily,
              }"
            >
              {{ node.label }}
            </div>
            <div v-if="node.type === 'weak-entity'" class="weak-entity-inner-diamond"></div>
            <div
              v-if="primarySelectedNode && primarySelectedNode.id === node.id"
              class="resize-handle"
              @pointerdown.stop.prevent="beginResize(node, $event)"
            />
          </div>
        </div>

        <aside
          v-if="primarySelectedNode"
          class="floating-toolbar"
          :style="{ left: `${floatingToolbar.x}px`, top: `${floatingToolbar.y}px` }"
        >
          <button class="toolbar-drag-handle" @pointerdown.stop.prevent="beginToolbarDrag($event)">工具列</button>
          <button class="floating-btn" @click="startConnectMode">連線</button>
          <button class="floating-btn" @click="startAppendMode">新增元素模式</button>
          <button class="floating-btn" @click="duplicateSelection">複製</button>
          <button class="floating-btn danger" @click="removeCurrentSelection">刪除</button>
          <div class="floating-divider"></div>
          <button class="floating-btn menu-toggle" @click="toggleToolbarMenu('changeOpen')">
            改元素
          </button>
          <div v-if="toolbarMenu.changeOpen" class="floating-submenu">
            <button
              v-for="item in ELEMENTS"
              :key="`shape-${item.type}`"
              class="floating-btn submenu-item"
              @click="changeSelectedType(item.type)"
            >
              改為{{ item.label }}
            </button>
          </div>
          <button class="floating-btn menu-toggle" @click="toggleToolbarMenu('addOpen')">
            新增
          </button>
          <div v-if="toolbarMenu.addOpen" class="floating-submenu">
            <button
              v-for="item in ELEMENTS"
              :key="`add-${item.type}`"
              class="floating-btn submenu-item"
              @click="onToolbarAddType(item.type)"
            >
              新增{{ item.label }}
            </button>
          </div>
        </aside>
      </div>
    </main>
  </section>
</template>

<style scoped>
.er-editor {
  display: grid;
  grid-template-columns: 290px 1fr;
  gap: 12px;
  min-height: 0;
  height: 100%;
}

.tool-panel {
  border: 1px solid var(--mac-border);
  border-radius: 14px;
  background: var(--mac-surface-strong);
  padding: 12px;
  overflow: auto;
}

.tool-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.tool-group h3 {
  font-size: 13px;
  margin: 0;
}

.palette-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.palette-btn {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 9px;
}

.palette-icon {
  width: 20px;
  height: 16px;
  border: 1px solid #111;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background: #fff;
}

.palette-icon.type-attribute {
  border-radius: 999px;
}

.palette-icon.type-relationship {
  width: 14px;
  height: 14px;
  transform: rotate(45deg);
}

.palette-icon.type-weak-entity .inner-diamond {
  width: 8px;
  height: 8px;
  border: 1px solid #111;
  transform: rotate(45deg);
}

.tool-group label {
  font-size: 12px;
  color: var(--mac-subtext);
}

.tool-group input,
.tool-group select {
  border: 1px solid var(--mac-border);
  background: #fff;
  border-radius: 8px;
  padding: 7px 8px;
  font-size: 13px;
}

.tool-btn {
  border: 1px solid var(--mac-border);
  background: var(--mac-surface);
  border-radius: 9px;
  padding: 8px 9px;
  font-size: 12px;
  cursor: pointer;
}

.tool-btn.active {
  border-color: rgba(10, 132, 255, 0.68);
  color: #0a5ed8;
  background: rgba(10, 132, 255, 0.12);
}

.tool-btn.danger {
  color: #c4453c;
  border-color: rgba(255, 69, 58, 0.35);
  background: rgba(255, 69, 58, 0.08);
}

.tool-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--mac-subtext);
}

.canvas-panel {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.canvas-toolbar {
  border: 1px solid var(--mac-border);
  border-radius: 10px;
  background: var(--mac-surface-strong);
  padding: 6px 8px;
  display: flex;
  justify-content: flex-end;
}

.zoom-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.zoom-btn {
  border: 1px solid var(--mac-border);
  background: #fff;
  border-radius: 7px;
  min-width: 30px;
  height: 28px;
  font-size: 13px;
  cursor: pointer;
}

.zoom-btn.fit {
  min-width: 52px;
  font-size: 12px;
}

.zoom-scale {
  min-width: 50px;
  text-align: center;
  font-size: 12px;
  color: var(--mac-subtext);
}

.er-canvas {
  position: relative;
  border: 1px solid var(--mac-border);
  border-radius: 14px;
  background: #eef3fc;
  overflow: hidden;
  min-height: 520px;
  height: 100%;
  touch-action: none;
  cursor: grab;
}

.er-canvas.panning {
  cursor: grabbing;
}

.canvas-grid {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(rgba(90, 111, 145, 0.11) 1px, transparent 1px),
    linear-gradient(90deg, rgba(90, 111, 145, 0.11) 1px, transparent 1px),
    #eef3fc;
  pointer-events: none;
}

.scene {
  position: relative;
}

.edge-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.edge-hit {
  stroke: transparent;
  stroke-width: 14;
  cursor: pointer;
}

.edge-visible {
  stroke: #111111;
  stroke-width: 2.2;
  stroke-linecap: round;
  pointer-events: none;
}

.edge-visible.selected {
  stroke: #111111;
  stroke-width: 3;
}

.node-card {
  position: absolute;
  border: 1px solid #111;
  border-radius: 12px;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-shadow: 0 6px 16px rgba(27, 36, 56, 0.12);
}

.node-card[data-type='attribute'] {
  border-radius: 999px;
}

.node-card[data-type='relationship'] {
  border: 0;
  background: transparent;
  box-shadow: none;
}

.node-card[data-type='relationship']::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 70.710678%;
  height: 70.710678%;
  background: #fff;
  border: 1.4px solid #111;
  box-sizing: border-box;
  transform: translate(-50%, -50%) rotate(45deg);
  transform-origin: center;
}

.node-card[data-type='relationship'] .node-label-display,
.node-card[data-type='relationship'] .node-label-input {
  text-align: center;
  position: relative;
  z-index: 1;
}

.node-card[data-type='relationship'] .resize-handle {
  z-index: 2;
}

.node-card[data-type='relationship'].selected::before {
  border-color: rgba(10, 132, 255, 0.88);
  box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.18);
}

.node-card.selected {
  border-color: rgba(10, 132, 255, 0.66);
  box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.18), 0 6px 16px rgba(27, 36, 56, 0.12);
}

.weak-entity-inner-diamond {
  position: absolute;
  inset: 12px 10px;
  background: transparent;
  border: 1px solid #111;
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  pointer-events: none;
  box-sizing: border-box;
}

.node-card.source {
  border-color: rgba(255, 149, 0, 0.72);
}

.node-label-display {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 10px;
  text-align: center;
  line-height: 1.3;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: none;
  pointer-events: none;
}

.node-label-input {
  border: 0;
  background: transparent;
  padding: 0 10px;
  width: calc(100% - 20px);
  height: 34px;
  margin: auto 0;
  align-self: center;
  outline: none;
  line-height: 1.3;
  text-align: center;
}

.node-label-input.editing {
  background: rgba(255, 255, 255, 0.92);
}

.resize-handle {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid rgba(10, 132, 255, 0.7);
  background: rgba(10, 132, 255, 0.2);
  cursor: nwse-resize;
}

.floating-toolbar {
  position: absolute;
  z-index: 8;
  min-width: 132px;
  border: 1px solid var(--mac-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 10px 28px rgba(16, 25, 44, 0.22);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toolbar-drag-handle {
  border: 0;
  background: rgba(238, 243, 253, 0.95);
  border-bottom: 1px solid var(--mac-border);
  font-size: 11px;
  color: #617393;
  padding: 6px 8px;
  text-align: left;
  cursor: grab;
}

.floating-btn {
  border: 0;
  border-bottom: 1px solid rgba(153, 166, 190, 0.21);
  background: transparent;
  text-align: left;
  padding: 7px 8px;
  font-size: 12px;
  cursor: pointer;
}

.floating-btn:hover {
  background: rgba(10, 132, 255, 0.08);
}

.floating-btn.danger {
  color: #c4453c;
}

.floating-divider {
  height: 1px;
  background: rgba(153, 166, 190, 0.21);
}

.menu-toggle {
  font-weight: 700;
}

.floating-submenu {
  display: flex;
  flex-direction: column;
}

.submenu-item {
  padding-left: 14px;
}

.muted {
  color: var(--mac-muted);
  font-size: 12px;
}

@media (max-width: 1100px) {
  .er-editor {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .er-canvas {
    min-height: 340px;
  }
}
</style>
