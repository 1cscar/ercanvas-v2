<script setup>
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

onMounted(() => {
  const id = route.query.id
  const type = route.query.type || 'er'
  if (id) {
    window.location.href = `/app.html?id=${encodeURIComponent(id)}&type=${encodeURIComponent(type)}`
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center" style="background: var(--mac-bg);">
    <div class="max-w-lg w-full px-8 py-10 rounded-2xl" style="background: var(--mac-surface-strong); border: 1px solid var(--mac-border); box-shadow: var(--mac-shadow-soft);">
      <div class="flex flex-col gap-4">
        <div class="w-12 h-12 rounded-2xl flex items-center justify-center" style="background: rgba(10, 132, 255, 0.12); color: var(--mac-accent);">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M4 5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z" stroke="currentColor" stroke-width="2"/>
            <path d="M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>

        <div>
          <h1 class="text-xl font-semibold" style="color: var(--mac-text);">正在開啟編輯器</h1>
          <p class="text-sm mt-2" style="color: var(--mac-subtext);">
            Vue 3 外殼已經接到 Supabase，編輯器本體目前先沿用整理後的 legacy editor，正在載入指定圖表。
          </p>
        </div>

        <div class="rounded-xl px-4 py-3 text-sm" style="background: var(--mac-surface); border: 1px solid var(--mac-border); color: var(--mac-subtext);">
          <div>Diagram ID: <span style="color: var(--mac-text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">{{ route.query.id || '未指定' }}</span></div>
          <div class="mt-1">Diagram Type: <span style="color: var(--mac-text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">{{ route.query.type || 'er' }}</span></div>
        </div>

        <RouterLink to="/home" class="inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-medium" style="background: var(--mac-accent); color: white;">
          回到圖表列表
        </RouterLink>
      </div>
    </div>
  </div>
</template>
