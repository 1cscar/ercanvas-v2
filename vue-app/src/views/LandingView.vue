<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const ctaLabel = computed(() => (auth.user ? '進入工作台' : '免費開始'))

function goPrimary() {
  if (auth.user) router.push('/home')
  else router.push('/login')
}
</script>

<template>
  <div class="landing-root">
    <header class="landing-header">
      <div class="brand">
        <div class="brand-icon">◧</div>
        <strong>ERCanvas</strong>
      </div>
      <div class="header-actions">
        <button class="ghost-btn" @click="router.push('/login')">登入</button>
        <button class="primary-btn" @click="goPrimary">{{ ctaLabel }}</button>
      </div>
    </header>

    <main class="hero">
      <section class="hero-copy">
        <h1>資料庫塑模改成純 Vue 組件化流程</h1>
        <p>
          現在 ER / Logical / Physical / Table 編輯與儲存都走 Vue 3 + Supabase，
          不再依賴舊版單檔 `app.html`。
        </p>
        <div class="hero-actions">
          <button class="primary-btn" @click="goPrimary">{{ ctaLabel }}</button>
          <button class="ghost-btn" @click="router.push('/home')">看我的圖表</button>
        </div>
      </section>

      <section class="hero-panel">
        <div class="status-chip">Vue Native Editor</div>
        <ul>
          <li>元件生命週期：由 Vue 接管</li>
          <li>跨裝置同步：由 Supabase 接管</li>
          <li>資料模型：ER / LM / PM / Table</li>
          <li>儲存策略：Auto-save + Manual Save</li>
        </ul>
      </section>
    </main>
  </div>
</template>

<style scoped>
.landing-root {
  min-height: 100vh;
  background:
    radial-gradient(900px 560px at 86% -20%, rgba(10, 132, 255, 0.22), transparent 62%),
    radial-gradient(720px 480px at -8% 110%, rgba(96, 117, 168, 0.18), transparent 60%),
    var(--mac-bg);
  color: var(--mac-text);
}

.landing-header {
  max-width: 1080px;
  margin: 0 auto;
  padding: 18px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.brand-icon {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--mac-accent);
  color: #fff;
  display: grid;
  place-items: center;
}

.header-actions,
.hero-actions {
  display: inline-flex;
  gap: 8px;
}

.primary-btn,
.ghost-btn {
  border-radius: 10px;
  border: 1px solid var(--mac-border);
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.primary-btn {
  border-color: rgba(10, 132, 255, 0.3);
  background: rgba(10, 132, 255, 0.13);
  color: var(--mac-accent);
}

.ghost-btn {
  background: var(--mac-surface-strong);
  color: var(--mac-subtext);
}

.hero {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px 20px 30px;
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 18px;
}

.hero-copy,
.hero-panel {
  border: 1px solid var(--mac-border);
  border-radius: 16px;
  background: var(--mac-surface-strong);
  padding: 18px;
  box-shadow: var(--mac-shadow-soft);
}

.hero-copy h1 {
  margin: 0 0 10px;
  font-size: 34px;
  line-height: 1.18;
}

.hero-copy p {
  margin: 0 0 14px;
  color: var(--mac-subtext);
  font-size: 14px;
  line-height: 1.5;
}

.status-chip {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(10, 132, 255, 0.25);
  background: rgba(10, 132, 255, 0.1);
  color: var(--mac-accent);
  font-size: 11px;
  font-weight: 700;
}

.hero-panel ul {
  margin: 12px 0 0;
  padding: 0 0 0 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--mac-subtext);
  font-size: 13px;
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
  }

  .hero-copy h1 {
    font-size: 26px;
  }
}
</style>
