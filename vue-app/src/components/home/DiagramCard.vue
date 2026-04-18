<script setup>
const props = defineProps({
  diagram: { type: Object, required: true },
  isRenaming: { type: Boolean, default: false },
  renameValue: { type: String, default: '' },
  typeLabel: { type: String, required: true },
  typeColor: { type: String, required: true },
  formattedDate: { type: String, default: '' },
})

const emit = defineEmits([
  'open',
  'rename-start',
  'rename-commit',
  'update:renameValue',
  'trash',
  'restore',
  'perm-delete',
])

function onRenameInput(event) {
  emit('update:renameValue', event.target.value)
}
</script>

<template>
  <article
    class="diagram-card"
    :class="{ trashed: !!props.diagram.deletedAt }"
    :style="{ '--type-color': props.typeColor }"
    @click="!props.diagram.deletedAt && emit('open')"
  >
    <div class="card-preview">
      <div class="card-type-badge">{{ props.typeLabel }}</div>
      <div class="card-preview-icon">
        <svg width="40" height="40" viewBox="0 0 36 36" fill="none" opacity="0.15">
          <rect x="4" y="4" width="12" height="12" rx="2" fill="var(--type-color)"/>
          <rect x="20" y="4" width="12" height="12" rx="2" fill="var(--type-color)"/>
          <rect x="4" y="20" width="12" height="12" rx="2" fill="var(--type-color)"/>
          <rect x="20" y="20" width="12" height="12" rx="2" fill="var(--type-color)"/>
        </svg>
      </div>
    </div>

    <div class="card-info">
      <div v-if="props.isRenaming" class="rename-input-wrap" @click.stop>
        <input
          :value="props.renameValue"
          class="rename-input"
          @input="onRenameInput"
          @keydown.enter="emit('rename-commit')"
          @keydown.escape="emit('rename-commit')"
          @blur="emit('rename-commit')"
          autofocus
        />
      </div>
      <div v-else class="card-name">{{ props.diagram.name || '未命名' }}</div>
      <div class="card-meta">{{ props.formattedDate }}</div>
    </div>

    <div class="card-actions" @click.stop>
      <template v-if="!props.diagram.deletedAt">
        <button class="card-action primary" @click="emit('open')">開啟</button>
        <button class="card-action" @click="emit('rename-start')">改名</button>
        <button class="card-action danger" @click="emit('trash')">刪除</button>
      </template>
      <template v-else>
        <button class="card-action" @click="emit('restore')">還原</button>
        <button class="card-action danger" @click="emit('perm-delete')">永久刪除</button>
      </template>
    </div>
  </article>
</template>

<style scoped>
.diagram-card {
  position: relative;
  background: var(--mac-card-fill);
  border: 1px solid var(--mac-border);
  border-radius: 14px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.18s;
  box-shadow: 0 2px 8px rgba(31,39,57,0.06);
}

.diagram-card:hover:not(.trashed) {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(31,39,57,0.12);
  border-color: var(--mac-accent);
}

.diagram-card.trashed {
  opacity: 0.72;
  cursor: default;
}

.card-preview {
  height: 120px;
  background: var(--mac-card-fill-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border-bottom: 1px solid var(--mac-border-soft);
}

.card-type-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  background: var(--type-color);
  color: white;
  opacity: 0.92;
}

.card-info {
  padding: 10px 12px 12px;
}

.card-name {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--mac-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 3px;
}

.card-meta {
  font-size: 11.5px;
  color: var(--mac-muted);
}

.rename-input-wrap {
  margin-bottom: 3px;
}

.rename-input {
  width: 100%;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--mac-text);
  border: 1px solid var(--mac-accent);
  border-radius: 5px;
  padding: 2px 6px;
  outline: none;
  background: white;
}

.card-actions {
  display: flex;
  gap: 8px;
  padding: 0 12px 12px;
}

.card-action {
  border: 1px solid var(--mac-border);
  background: var(--mac-surface);
  color: var(--mac-subtext);
  border-radius: 9px;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.card-action:hover {
  background: var(--mac-surface-strong);
  color: var(--mac-text);
}

.card-action.primary {
  border-color: rgba(10, 132, 255, 0.18);
  background: rgba(10, 132, 255, 0.12);
  color: var(--mac-accent);
}

.card-action.primary:hover {
  background: rgba(10, 132, 255, 0.18);
}

.card-action.danger {
  color: #ff453a;
  border-color: rgba(255, 69, 58, 0.2);
  background: rgba(255, 69, 58, 0.08);
}

.card-action.danger:hover {
  background: rgba(255, 69, 58, 0.14);
}
</style>
