<script setup>
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'

/**
 * Konva 超大邏輯畫布核心
 *
 * 設計重點：
 * 1) 邏輯空間固定為 55000 x 35000，但 Stage 永遠只等於視窗大小。
 * 2) 縮放/平移全部做在 Layer，不放大 Stage，避免 Safari GPU 合成層限制。
 * 3) 物件超過 5000 時，dragmove / wheel / resize 觸發 culling 都使用 rAF + throttle。
 */

const LOGICAL_WIDTH = 55000
const LOGICAL_HEIGHT = 35000
const MIN_SCALE = 0.05
const MAX_SCALE = 5
const ZOOM_BUTTON_FACTOR = 1.12
const OVERVIEW_PADDING_PX = 72

const emit = defineEmits([
  'ready',
  'logical-click',
  'viewport-change',
])

const container = shallowRef(null)

let Konva = null
let stage = null
let worldLayer = null
let objectGroup = null
let logicBoundsRect = null

// 不用 Vue 深層 reactivity 追蹤大量元素，避免 5000+ 物件時過高開銷。
const elements = shallowRef([])

let resizeHandler = null
let panState = null

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function intersects(a, b) {
  return !(
    a.x > b.x + b.width ||
    a.x + a.width < b.x ||
    a.y > b.y + b.height ||
    a.y + a.height < b.y
  )
}

/**
 * 使用 requestAnimationFrame + 最短間隔做節流。
 * 避免 dragmove 觸發過於頻繁導致 culling + draw 過載。
 */
function throttleWithRaf(fn, minIntervalMs = 32) {
  let rafId = 0
  let queued = false
  let lastRun = 0

  const loop = (ts) => {
    if (!queued) {
      rafId = 0
      return
    }
    if (ts - lastRun < minIntervalMs) {
      rafId = requestAnimationFrame(loop)
      return
    }
    queued = false
    lastRun = ts
    fn()
    rafId = requestAnimationFrame(loop)
  }

  return () => {
    queued = true
    if (!rafId) rafId = requestAnimationFrame(loop)
  }
}

function requestLayerDraw() {
  if (!stage) return
  stage.batchDraw()
}

function getViewportRect() {
  if (!stage) return { x: 0, y: 0, width: 0, height: 0 }
  return {
    x: 0,
    y: 0,
    width: stage.width(),
    height: stage.height(),
  }
}

/**
 * 將螢幕座標轉換回 55000 x 35000 邏輯空間。
 * 座標轉換核心：
 * logical = (screen - layerPosition) / layerScale
 */
function getLogicalPosition(stageX, stageY) {
  if (!worldLayer) return { x: 0, y: 0 }
  const pos = worldLayer.position()
  const scale = worldLayer.scaleX() || 1
  return {
    x: (stageX - pos.x) / scale,
    y: (stageY - pos.y) / scale,
  }
}

function applyCullingNow() {
  if (!stage || !objectGroup) return
  const viewport = getViewportRect()
  const list = elements.value
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i]
    const node = entry.node
    if (!node) continue
    // 取畫面實際包圍盒（已含 Layer transform），和 viewport 比對。
    const rect = node.getClientRect({ skipShadow: true, skipStroke: false })
    const visible = intersects(rect, viewport)
    if (node.visible() !== visible) node.visible(visible)
  }
  requestLayerDraw()
}

const throttledCull = throttleWithRaf(applyCullingNow, 24)

function updateViewportMeta() {
  if (!worldLayer) return
  emit('viewport-change', {
    scale: worldLayer.scaleX(),
    position: worldLayer.position(),
  })
}

function setViewport(next = {}, options = {}) {
  if (!worldLayer) return
  const useThrottle = options.throttle !== false
  const currentScale = worldLayer.scaleX() || 1
  const targetScale = Number.isFinite(next.scale) ? clamp(Number(next.scale), MIN_SCALE, MAX_SCALE) : currentScale
  const currentPos = worldLayer.position()
  worldLayer.scale({ x: targetScale, y: targetScale })
  worldLayer.position({
    x: Number.isFinite(next.x) ? Number(next.x) : currentPos.x,
    y: Number.isFinite(next.y) ? Number(next.y) : currentPos.y,
  })
  if (useThrottle) throttledCull()
  else applyCullingNow()
  updateViewportMeta()
  requestLayerDraw()
}

function applyScaleAroundScreenPoint(nextScale, screenX, screenY, options = {}) {
  if (!worldLayer) return
  const targetScale = clamp(Number(nextScale) || 1, MIN_SCALE, MAX_SCALE)
  const logicalPoint = getLogicalPosition(screenX, screenY)
  setViewport({
    scale: targetScale,
    x: screenX - logicalPoint.x * targetScale,
    y: screenY - logicalPoint.y * targetScale,
  }, options)
}

function fitStageToWindow() {
  if (!stage) return
  stage.size({
    width: window.innerWidth,
    height: window.innerHeight,
  })
  throttledCull()
  updateViewportMeta()
}

function onWheelZoomAtPointer(e) {
  e.evt.preventDefault()
  if (!stage || !worldLayer) return

  const pointer = stage.getPointerPosition()
  if (!pointer) return

  const oldScale = worldLayer.scaleX()
  const direction = e.evt.deltaY > 0 ? -1 : 1
  const scaleBy = direction > 0 ? 1.08 : (1 / 1.08)
  const nextScale = clamp(oldScale * scaleBy, MIN_SCALE, MAX_SCALE)
  applyScaleAroundScreenPoint(nextScale, pointer.x, pointer.y)
}

function onPointerDown(e) {
  if (!stage) return
  const target = e.target
  const hitBackground = target === stage || target === logicBoundsRect
  if (!hitBackground) return

  const pos = stage.getPointerPosition()
  if (!pos) return
  panState = {
    startPointer: { x: pos.x, y: pos.y },
    startLayer: { x: worldLayer.x(), y: worldLayer.y() },
  }
  stage.container().style.cursor = 'grabbing'
}

function onPointerMove(e) {
  if (!panState || !stage || !worldLayer) return
  e.evt.preventDefault()
  const pos = stage.getPointerPosition()
  if (!pos) return
  worldLayer.position({
    x: panState.startLayer.x + (pos.x - panState.startPointer.x),
    y: panState.startLayer.y + (pos.y - panState.startPointer.y),
  })
  throttledCull()
  updateViewportMeta()
  requestLayerDraw()
}

function onPointerUp() {
  if (panState) {
    panState = null
    if (stage?.container()) stage.container().style.cursor = 'grab'
  }
}

function onStageClick() {
  if (!stage) return
  const pointer = stage.getPointerPosition()
  if (!pointer) return
  const logical = getLogicalPosition(pointer.x, pointer.y)
  emit('logical-click', logical)
}

function addObject(x, y) {
  if (!Konva || !objectGroup) return null
  const rect = new Konva.Rect({
    x,
    y,
    width: 140,
    height: 84,
    fill: '#ffffff',
    stroke: '#111111',
    strokeWidth: 1,
    cornerRadius: 10,
    draggable: false,
  })
  objectGroup.add(rect)
  elements.value.push({
    id: `obj_${Math.random().toString(36).slice(2, 9)}`,
    node: rect,
  })
  throttledCull()
  return rect
}

function setCullingNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes : []
  elements.value = list.map((node, idx) => ({
    id: `node_${idx}`,
    node,
  }))
  throttledCull()
}

function clearObjects() {
  if (!objectGroup) return
  for (let i = 0; i < elements.value.length; i += 1) {
    elements.value[i].node?.destroy()
  }
  elements.value = []
  requestLayerDraw()
}

function getContentLogicalBounds() {
  if (!worldLayer) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let i = 0; i < elements.value.length; i += 1) {
    const node = elements.value[i]?.node
    if (!node) continue
    // Temporarily show culled nodes — invisible nodes may return empty rects in some Konva versions
    const wasVisible = node.visible()
    if (!wasVisible) node.visible(true)
    const rect = node.getClientRect({ skipShadow: true, skipStroke: false, relativeTo: worldLayer })
    if (!wasVisible) node.visible(false)
    if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y) || rect.width <= 0 || rect.height <= 0) continue
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function zoomIn() {
  if (!stage || !worldLayer) return
  const nextScale = clamp((worldLayer.scaleX() || 1) * ZOOM_BUTTON_FACTOR, MIN_SCALE, MAX_SCALE)
  applyScaleAroundScreenPoint(nextScale, stage.width() / 2, stage.height() / 2)
}

function zoomOut() {
  if (!stage || !worldLayer) return
  const nextScale = clamp((worldLayer.scaleX() || 1) / ZOOM_BUTTON_FACTOR, MIN_SCALE, MAX_SCALE)
  applyScaleAroundScreenPoint(nextScale, stage.width() / 2, stage.height() / 2)
}

function fitToOverview(options = {}) {
  if (!stage || !worldLayer) return
  const upperScale = Number.isFinite(options.maxScale) ? options.maxScale : MAX_SCALE
  const bounds = getContentLogicalBounds()
  if (!bounds) {
    setViewport({
      scale: clamp(1, MIN_SCALE, upperScale),
      x: (stage.width() / 2) - (LOGICAL_WIDTH / 2),
      y: (stage.height() / 2) - (LOGICAL_HEIGHT / 2),
    }, { throttle: false })
    return
  }

  const fitScale = clamp(
    Math.min(
      (stage.width() - OVERVIEW_PADDING_PX * 2) / bounds.width,
      (stage.height() - OVERVIEW_PADDING_PX * 2) / bounds.height,
    ),
    MIN_SCALE,
    upperScale,
  )

  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  setViewport({
    scale: fitScale,
    x: (stage.width() / 2) - centerX * fitScale,
    y: (stage.height() / 2) - centerY * fitScale,
  }, { throttle: false })
}

function destroyStage() {
  panState = null
  if (stage) {
    stage.destroy()
    stage = null
  }
  worldLayer = null
  objectGroup = null
  logicBoundsRect = null
}

function loadKonvaFromLocalVendor() {
  return new Promise((resolve, reject) => {
    if (window.Konva) {
      resolve(window.Konva)
      return
    }
    const existing = document.querySelector('script[data-konva-vendor="true"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Konva))
      existing.addEventListener('error', () => reject(new Error('Konva script load failed')))
      return
    }
    const script = document.createElement('script')
    script.src = '/vendor/konva.min.js'
    script.async = true
    script.dataset.konvaVendor = 'true'
    script.onload = () => resolve(window.Konva)
    script.onerror = () => reject(new Error('Konva script load failed'))
    document.head.appendChild(script)
  })
}

function initStage() {
  if (!Konva || !container.value) return

  stage = new Konva.Stage({
    container: container.value,
    width: window.innerWidth,
    height: window.innerHeight,
  })

  worldLayer = new Konva.Layer({
    x: 24,
    y: 24,
    scaleX: 1,
    scaleY: 1,
  })
  objectGroup = new Konva.Group({
    x: 0,
    y: 0,
    listening: true,
  })

  // 邏輯邊界僅用於 hit 空白與可視化，不把 Stage 擴到 55k x 35k。
  logicBoundsRect = new Konva.Rect({
    x: 0,
    y: 0,
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
    fill: '#eef3fc',
    listening: true,
  })

  worldLayer.add(logicBoundsRect)
  worldLayer.add(objectGroup)
  stage.add(worldLayer)

  stage.on('wheel', onWheelZoomAtPointer)
  stage.on('mousedown touchstart', onPointerDown)
  stage.on('mousemove touchmove', onPointerMove)
  stage.on('mouseup touchend touchcancel', onPointerUp)
  stage.on('click tap', onStageClick)

  stage.container().style.cursor = 'grab'

  resizeHandler = throttleWithRaf(() => {
    fitStageToWindow()
  }, 50)
  window.addEventListener('resize', resizeHandler)

  applyCullingNow()
  emit('ready', {
    addObject,
    setCullingNodes,
    clearObjects,
    getLogicalPosition,
    setViewport,
    fitToOverview,
    zoomIn,
    zoomOut,
    getLogicalBounds: () => ({ width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT }),
    getKonva: () => Konva,
    getStage: () => stage,
    getLayers: () => ({ worldLayer, objectGroup }),
  })
}

defineExpose({
  addObject,
  setCullingNodes,
  clearObjects,
  getLogicalPosition,
  setViewport,
  getLogicalBounds: () => ({ width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT }),
  fitToOverview,
  zoomIn,
  zoomOut,
  getKonva: () => Konva,
  getStage: () => stage,
  getLayers: () => ({ worldLayer, objectGroup }),
})

onMounted(async () => {
  Konva = await loadKonvaFromLocalVendor()
  initStage()
})

onBeforeUnmount(() => {
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    resizeHandler = null
  }
  destroyStage()
})
</script>

<template>
  <div class="konva-huge-canvas">
    <div ref="container" class="konva-stage-host"></div>
    <div class="canvas-controls">
      <button class="canvas-control-btn" @mousedown.stop @click.stop="zoomIn">+</button>
      <button class="canvas-control-btn" @mousedown.stop @click.stop="zoomOut">-</button>
      <button class="canvas-control-btn overview" @mousedown.stop @click.stop="fitToOverview">全覽</button>
    </div>
  </div>
</template>

<style scoped>
.konva-huge-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 520px;
  border: 1px solid var(--mac-border);
  border-radius: 14px;
  overflow: hidden;
  background: #eef3fc;
}

.konva-stage-host {
  width: 100%;
  height: 100%;
  min-height: inherit;
}

.canvas-controls {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 15;
  display: flex;
  gap: 6px;
  align-items: center;
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

.canvas-control-btn.overview {
  min-width: 46px;
  font-size: 12px;
  font-weight: 600;
}

.canvas-control-btn:hover {
  background: #ffffff;
  border-color: #c2ccdc;
}
</style>
