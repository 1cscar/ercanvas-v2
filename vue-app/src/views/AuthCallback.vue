<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/lib/supabase'

const router = useRouter()
const error = ref('')

onMounted(async () => {
  // If session already exists (e.g. page refresh), skip code exchange and go home.
  const { data: existing } = await supabase.auth.getSession()
  if (existing?.session) {
    router.replace('/home')
    return
  }

  const code = new URL(window.location.href).searchParams.get('code')

  if (!code) {
    error.value = '找不到登入授權碼，請重新登入。'
    return
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    error.value = exchangeError.message || '登入交換失敗，請重新嘗試。'
    return
  }

  router.replace('/home')
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center" style="background: linear-gradient(135deg, var(--mac-bg) 0%, var(--mac-bg-deep) 100%);">
    <div class="max-w-md w-full px-8 py-10 rounded-2xl text-center" style="background: var(--mac-surface-strong); border: 1px solid var(--mac-border); box-shadow: var(--mac-shadow-soft);">
      <div v-if="!error" class="flex flex-col items-center gap-4">
        <svg class="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none" style="color: var(--mac-accent);">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" opacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <div>
          <h1 class="text-lg font-semibold" style="color: var(--mac-text);">完成登入中</h1>
          <p class="text-sm mt-1" style="color: var(--mac-subtext);">正在建立 Supabase session...</p>
        </div>
      </div>

      <div v-else class="flex flex-col items-center gap-4">
        <div class="w-12 h-12 rounded-full flex items-center justify-center" style="background: rgba(255, 69, 58, 0.12); color: #ff453a;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
            <path d="M12 8v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <circle cx="12" cy="16.5" r="1" fill="currentColor"/>
          </svg>
        </div>
        <div>
          <h1 class="text-lg font-semibold" style="color: var(--mac-text);">登入失敗</h1>
          <p class="text-sm mt-1" style="color: var(--mac-subtext);">{{ error }}</p>
        </div>
        <button class="px-4 py-2 rounded-xl text-sm font-medium" style="background: var(--mac-accent); color: white;" @click="router.replace('/login')">
          回到登入頁
        </button>
      </div>
    </div>
  </div>
</template>
