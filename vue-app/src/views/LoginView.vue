<script setup>
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const loading = ref(false)
const error = ref('')

async function handleLogin() {
  loading.value = true
  error.value = ''
  try {
    await auth.loginWithGoogle()
  } catch (e) {
    error.value = e.message || '登入失敗，請再試一次'
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center" style="background: linear-gradient(135deg, var(--mac-bg) 0%, var(--mac-bg-deep) 100%);">
    <div class="mac-card flex flex-col items-center gap-6 px-10 py-12 w-full max-w-sm">
      <!-- Logo -->
      <div class="flex flex-col items-center gap-2">
        <div class="w-16 h-16 rounded-2xl flex items-center justify-center" style="background: var(--mac-accent);">
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="4" width="12" height="12" rx="2" fill="white"/>
            <rect x="20" y="4" width="12" height="12" rx="2" fill="white" opacity="0.7"/>
            <rect x="4" y="20" width="12" height="12" rx="2" fill="white" opacity="0.7"/>
            <rect x="20" y="20" width="12" height="12" rx="2" fill="white" opacity="0.5"/>
            <line x1="16" y1="10" x2="20" y2="10" stroke="white" stroke-width="2"/>
            <line x1="10" y1="16" x2="10" y2="20" stroke="white" stroke-width="2"/>
          </svg>
        </div>
        <h1 class="text-2xl font-semibold" style="color: var(--mac-text);">ERCanvas</h1>
        <p class="text-sm" style="color: var(--mac-subtext);">ER 模型設計工具</p>
      </div>

      <!-- Login button -->
      <button
        @click="handleLogin"
        :disabled="loading"
        class="w-full flex items-center justify-center gap-3 py-3 px-5 rounded-xl font-medium transition-all"
        style="background: white; color: var(--mac-text); border: 1px solid var(--mac-border); box-shadow: 0 1px 4px rgba(0,0,0,0.08);"
      >
        <svg v-if="!loading" width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.8 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.8 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.3 0-9.7-3.4-11.3-8H6.1C9.4 35.6 16.2 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C37.2 39.5 44 34.6 44 24c0-1.3-.1-2.6-.4-3.9z"/>
        </svg>
        <svg v-else class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" opacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span>{{ loading ? '跳轉到 Google 中...' : '使用 Google 登入' }}</span>
      </button>

      <p v-if="error" class="text-sm text-center" style="color: #ff453a;">{{ error }}</p>

      <p class="text-xs text-center" style="color: var(--mac-muted);">登入即表示您同意我們的服務條款與隱私權政策</p>
    </div>
  </div>
</template>

<style scoped>
.mac-card {
  background: var(--mac-surface-strong);
  border: 1px solid var(--mac-border);
  border-radius: 18px;
  box-shadow: var(--mac-shadow-soft);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}

button:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.12) !important;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
