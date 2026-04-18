<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  content: {
    type: Object,
    default: () => ({ nodes: [], edges: [], nextId: 1 }),
  },
})

const emit = defineEmits(['update:content'])

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeNode(node) {
  const base = {
    id: '',
    type: 'entity',
    label: '未命名節點',
    x: 80,
    y: 80,
    w: 132,
    h: 64,
  }
  const next = { ...base, ...(node || {}) }
  if (!next.id) next.id = `n_${Math.random().toString(36).slice(2, 8)}`
  return next
}

function normalizeContent(content) {
  const raw = content || {}
  const nodes = Array.isArray(raw.nodes) ? raw.nodes.map(normalizeNode) : []
  const edges = Array.isArray(raw.edges) ? raw.edges.map((e) => ({ ...e })) : []
  const nextId = Number.isFinite(raw.nextId) ? raw.nextId : (nodes.length + edges.length + 1)
  return { nodes, edges, nextId }
}

const local = ref(normalizeContent(props.content))
const selectedNodeId = ref('')
const edgeDraft = ref({ from: '', to: '', labelFrom: '', labelTo: '' })
const canvasRef = ref(null)
const dragState = ref(null)

watch(
  () => props.content,
  (value) => {
    local.value = normalizeContent(value)
    if (selectedNodeId.value && !local.value.nodes.some((n) => n.id === selectedNodeId.value)) {
      selectedNodeId.value = ''
    }
  },
  { deep: true },
)

const selectedNode = computed(() => local.value.nodes.find((n) => n.id === selectedNodeId.value) || null)

const edgeRows = computed(() =>
  local.value.edges.map((edge) => ({
    ...edge,
    fromLabel: local.value.nodes.find((n) => n.id === edge.from)?.label || edge.from,
    toLabel: local.value.nodes.find((n) => n.id === edge.to)?.label || edge.to,
  })),
)

function commit() {
  emit('update:content', deepClone(local.value))
}

function nextNodeId(prefix = 'n') {
  const id = `${prefix}${local.value.nextId}`
  local.value.nextId += 1
  return id
}

function createNode(type) {
  const defaults = {
    entity: { label: '實體', w: 132, h: 64 },
    'weak-entity': { label: '弱實體', w: 132, h: 64 },
    relationship: { label: '關係', w: 110, h: 56 },
    attribute: { label: '屬性', w: 110, h: 56 },
  }
  const shape = defaults[type] || defaults.entity
  const idx = local.value.nodes.length
  const node = normalizeNode({
    id: nextNodeId('n'),
    type,
    label: shape.label,
    x: 60 + (idx % 4) * 170,
    y: 60 + Math.floor(idx / 4) * 120,
    w: shape.w,
    h: shape.h,
  })
  local.value.nodes.push(node)
  selectedNodeId.value = node.id
  commit()
}

function updateSelectedField(field, value) {
  if (!selectedNode.value) return
  selectedNode.value[field] = value
  commit()
}

function removeSelectedNode() {
  if (!selectedNode.value) return
  const id = selectedNode.value.id
  local.value.nodes = local.value.nodes.filter((n) => n.id !== id)
  local.value.edges = local.value.edges.filter((e) => e.from !== id && e.to !== id)
  selectedNodeId.value = ''
  commit()
}

function addEdge() {
  const from = edgeDraft.value.from
  const to = edgeDraft.value.to
  if (!from || !to || from === to) return
  const exists = local.value.edges.some((e) => (
    (e.from === from && e.to === to) ||
    (e.from === to && e.to === from)
  ))
  if (exists) return
  local.value.edges.push({
    id: nextNodeId('e'),
    from,
    to,
    labelFrom: edgeDraft.value.labelFrom || undefined,
    labelTo: edgeDraft.value.labelTo || undefined,
  })
  edgeDraft.value = { from: '', to: '', labelFrom: '', labelTo: '' }
  commit()
}

function removeEdge(id) {
  local.value.edges = local.value.edges.filter((e) => e.id !== id)
  commit()
}

function nodeCenter(node) {
  const w = Number(node.w) || 120
  const h = Number(node.h) || 60
  return {
    x: (Number(node.x) || 0) + w / 2,
    y: (Number(node.y) || 0) + h / 2,
  }
}

function beginDrag(node, event) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  dragState.value = {
    nodeId: node.id,
    offsetX: event.clientX - rect.left - (Number(node.x) || 0),
    offsetY: event.clientY - rect.top - (Number(node.y) || 0),
  }
  selectedNodeId.value = node.id
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', endDrag, { once: true })
}

function onPointerMove(event) {
  if (!dragState.value) return
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  const node = local.value.nodes.find((n) => n.id === dragState.value.nodeId)
  if (!node) return
  const nextX = Math.max(0, event.clientX - rect.left - dragState.value.offsetX)
  const nextY = Math.max(0, event.clientY - rect.top - dragState.value.offsetY)
  node.x = Math.round(nextX)
  node.y = Math.round(nextY)
}

function endDrag() {
  if (!dragState.value) return
  dragState.value = null
  window.removeEventListener('pointermove', onPointerMove)
  commit()
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
})
</script>

<template>
  <section class="er-editor">
    <aside class="tool-panel">
      <div class="tool-group">
        <button class="tool-btn" @click="createNode('entity')">新增實體</button>
        <button class="tool-btn" @click="createNode('relationship')">新增關係</button>
        <button class="tool-btn" @click="createNode('attribute')">新增屬性</button>
        <button class="tool-btn" @click="createNode('weak-entity')">新增弱實體</button>
        <button class="tool-btn danger" :disabled="!selectedNode" @click="removeSelectedNode">刪除選取節點</button>
      </div>

      <div class="tool-group" v-if="selectedNode">
        <h3>節點屬性</h3>
        <label>名稱</label>
        <input
          :value="selectedNode.label"
          @input="updateSelectedField('label', $event.target.value)"
        />
        <label>類型</label>
        <select
          :value="selectedNode.type"
          @change="updateSelectedField('type', $event.target.value)"
        >
          <option value="entity">entity</option>
          <option value="relationship">relationship</option>
          <option value="attribute">attribute</option>
          <option value="weak-entity">weak-entity</option>
        </select>
        <div class="row">
          <div>
            <label>X</label>
            <input
              type="number"
              :value="selectedNode.x"
              @input="updateSelectedField('x', Number($event.target.value) || 0)"
            />
          </div>
          <div>
            <label>Y</label>
            <input
              type="number"
              :value="selectedNode.y"
              @input="updateSelectedField('y', Number($event.target.value) || 0)"
            />
          </div>
        </div>
      </div>

      <div class="tool-group">
        <h3>新增連線</h3>
        <label>From</label>
        <select v-model="edgeDraft.from">
          <option value="">請選擇節點</option>
          <option v-for="node in local.nodes" :key="node.id" :value="node.id">{{ node.label }}</option>
        </select>
        <label>To</label>
        <select v-model="edgeDraft.to">
          <option value="">請選擇節點</option>
          <option v-for="node in local.nodes" :key="node.id" :value="node.id">{{ node.label }}</option>
        </select>
        <button class="tool-btn" @click="addEdge">建立連線</button>
      </div>
    </aside>

    <main class="canvas-panel">
      <div ref="canvasRef" class="er-canvas">
        <svg class="edge-layer">
          <line
            v-for="edge in local.edges"
            :key="edge.id"
            :x1="nodeCenter(local.nodes.find((n) => n.id === edge.from) || {}).x || 0"
            :y1="nodeCenter(local.nodes.find((n) => n.id === edge.from) || {}).y || 0"
            :x2="nodeCenter(local.nodes.find((n) => n.id === edge.to) || {}).x || 0"
            :y2="nodeCenter(local.nodes.find((n) => n.id === edge.to) || {}).y || 0"
            stroke="#7d8ea9"
            stroke-width="2"
          />
        </svg>

        <div
          v-for="node in local.nodes"
          :key="node.id"
          class="node-card"
          :class="{ selected: node.id === selectedNodeId }"
          :style="{
            left: `${node.x}px`,
            top: `${node.y}px`,
            width: `${node.w}px`,
            height: `${node.h}px`,
          }"
          @pointerdown.stop.prevent="beginDrag(node, $event)"
          @click.stop="selectedNodeId = node.id"
        >
          <span class="node-type">{{ node.type }}</span>
          <strong>{{ node.label }}</strong>
        </div>
      </div>

      <div class="edge-list">
        <h3>連線列表</h3>
        <div v-if="!edgeRows.length" class="muted">尚無連線</div>
        <div v-for="edge in edgeRows" :key="edge.id" class="edge-item">
          <span>{{ edge.fromLabel }} → {{ edge.toLabel }}</span>
          <button @click="removeEdge(edge.id)">刪除</button>
        </div>
      </div>
    </main>
  </section>
</template>

<style scoped>
.er-editor {
  display: grid;
  grid-template-columns: 260px 1fr;
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
  gap: 6px;
  margin-bottom: 14px;
}

.tool-group h3 {
  font-size: 13px;
  margin: 0;
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

.tool-btn.danger {
  color: #c4453c;
  border-color: rgba(255, 69, 58, 0.35);
  background: rgba(255, 69, 58, 0.08);
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.canvas-panel {
  display: grid;
  grid-template-rows: 1fr auto;
  gap: 10px;
  min-height: 0;
}

.er-canvas {
  position: relative;
  border: 1px solid var(--mac-border);
  border-radius: 14px;
  background:
    linear-gradient(rgba(90, 111, 145, 0.11) 1px, transparent 1px),
    linear-gradient(90deg, rgba(90, 111, 145, 0.11) 1px, transparent 1px),
    #eef3fc;
  background-size: 24px 24px;
  overflow: hidden;
  min-height: 420px;
}

.edge-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.node-card {
  position: absolute;
  border: 1px solid var(--mac-border);
  border-radius: 10px;
  background: #fff;
  padding: 8px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  cursor: grab;
  user-select: none;
  box-shadow: 0 4px 12px rgba(27, 36, 56, 0.1);
}

.node-card.selected {
  border-color: rgba(10, 132, 255, 0.65);
  box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.2);
}

.node-type {
  font-size: 10px;
  color: var(--mac-muted);
  text-transform: uppercase;
}

.node-card strong {
  font-size: 13px;
  color: var(--mac-text);
}

.edge-list {
  border: 1px solid var(--mac-border);
  border-radius: 12px;
  background: var(--mac-surface-strong);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.edge-list h3 {
  margin: 0;
  font-size: 13px;
}

.edge-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--mac-subtext);
}

.edge-item button {
  border: 1px solid var(--mac-border);
  background: var(--mac-surface);
  border-radius: 7px;
  padding: 4px 8px;
  cursor: pointer;
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
    min-height: 320px;
  }
}
</style>
