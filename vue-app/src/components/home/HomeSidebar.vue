<script setup>
defineProps({
  showTrash: { type: Boolean, required: true },
  myCount: { type: Number, default: 0 },
  trashCount: { type: Number, default: 0 },
  types: { type: Array, default: () => [] },
  creatingType: { type: String, default: null },
})

const emit = defineEmits(['update:showTrash', 'create'])
</script>

<template>
  <aside class="home-sidebar">
    <nav class="sidebar-nav">
      <button
        class="sidebar-item"
        :class="{ active: !showTrash }"
        @click="emit('update:showTrash', false)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
          <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
          <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
          <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
        </svg>
        <span>所有圖表</span>
        <span v-if="myCount" class="sidebar-badge">{{ myCount }}</span>
      </button>
      <button
        class="sidebar-item"
        :class="{ active: showTrash }"
        @click="emit('update:showTrash', true)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <span>垃圾桶</span>
        <span v-if="trashCount" class="sidebar-badge">{{ trashCount }}</span>
      </button>
    </nav>

    <div class="sidebar-section-label">建立新圖表</div>
    <div class="create-buttons">
      <button
        v-for="t in types"
        :key="t.key"
        class="create-btn"
        :disabled="creatingType !== null"
        @click="emit('create', t.key)"
      >
        <span class="create-btn-icon">{{ t.icon }}</span>
        <span class="create-btn-label">{{ t.label }}</span>
        <svg v-if="creatingType === t.key" class="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" opacity="0.3"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" style="opacity:0.4">
          <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.home-sidebar {
  width: 220px;
  flex-shrink: 0;
  padding: 16px 12px;
  background: var(--mac-panel);
  border-right: 1px solid var(--mac-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 16px;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--mac-subtext);
  font-size: 13.5px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}

.sidebar-item:hover {
  background: var(--mac-surface);
  color: var(--mac-text);
}

.sidebar-item.active {
  background: var(--mac-accent-soft);
  color: var(--mac-accent);
  font-weight: 500;
}

.sidebar-badge {
  margin-left: auto;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--mac-surface);
  color: var(--mac-muted);
}

.sidebar-item.active .sidebar-badge {
  background: var(--mac-accent);
  color: white;
}

.sidebar-section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--mac-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0 10px;
  margin-bottom: 6px;
}

.create-buttons {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.create-btn {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--mac-subtext);
  font-size: 13.5px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}

.create-btn:hover:not(:disabled) {
  background: var(--mac-surface);
  color: var(--mac-text);
}

.create-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.create-btn-icon {
  font-size: 15px;
}

.create-btn-label {
  flex: 1;
}

@media (max-width: 980px) {
  .home-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--mac-border);
  }
}
</style>
