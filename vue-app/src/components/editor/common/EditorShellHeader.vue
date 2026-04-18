<script setup>
defineProps({
  title: { type: String, default: '編輯器' },
  subtitle: { type: String, default: '' },
  modeLabel: { type: String, default: '' },
  disableReload: { type: Boolean, default: false },
})

const emit = defineEmits(['back', 'reload'])
</script>

<template>
  <header class="editor-shell-header mac-main-header">
    <div class="mac-window-controls">
      <span class="mac-window-dot red"></span>
      <span class="mac-window-dot yellow"></span>
      <span class="mac-window-dot green"></span>
    </div>

    <button class="shell-back-btn" @click="emit('back')">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      返回圖表列表
    </button>

    <div class="shell-title-wrap">
      <div class="shell-title-row">
        <span class="shell-title">{{ title }}</span>
        <span v-if="modeLabel" class="mac-chip">{{ modeLabel }}</span>
      </div>
      <div v-if="subtitle" class="shell-subtitle">{{ subtitle }}</div>
    </div>

    <div class="shell-actions">
      <button class="shell-action" :disabled="disableReload" @click="emit('reload')">
        重新載入
      </button>
    </div>
  </header>
</template>

<style scoped>
.editor-shell-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 18px;
  height: 56px;
  flex-shrink: 0;
  -webkit-app-region: drag;
}

.mac-window-controls,
.shell-back-btn,
.shell-actions {
  -webkit-app-region: no-drag;
}

.shell-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--mac-border);
  background: var(--mac-surface-strong);
  color: var(--mac-text);
  border-radius: 10px;
  padding: 8px 11px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.shell-back-btn:hover {
  background: rgba(255,255,255,0.98);
}

.shell-title-wrap {
  min-width: 0;
}

.shell-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.shell-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--mac-text);
}

.shell-subtitle {
  font-size: 11.5px;
  color: var(--mac-subtext);
  margin-top: 2px;
}

.shell-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.shell-action {
  border: 1px solid var(--mac-border);
  background: var(--mac-surface-strong);
  color: var(--mac-subtext);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.shell-action:hover:not(:disabled) {
  color: var(--mac-text);
  background: rgba(255,255,255,0.98);
}

.shell-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .editor-shell-header {
    flex-wrap: wrap;
    align-items: flex-start;
    height: auto;
    padding-top: 12px;
    padding-bottom: 12px;
  }

  .shell-actions {
    width: 100%;
    margin-left: 0;
  }
}
</style>
