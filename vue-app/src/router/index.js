import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes = [
  { path: '/',        redirect: '/home' },
  { path: '/login',   component: () => import('@/views/LoginView.vue'), meta: { public: true } },
  { path: '/auth/callback', component: () => import('@/views/AuthCallback.vue'), meta: { public: true } },
  { path: '/home',    component: () => import('@/views/HomeView.vue'),  meta: { requiresAuth: true } },
  { path: '/editor',  component: () => import('@/views/EditorView.vue'), meta: { requiresAuth: true } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Auth guard — wait for the first session check before deciding to redirect.
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()
  if (to.meta.requiresAuth && !auth.user) return '/login'
  if (to.path === '/login' && auth.user) return '/home'
})

export default router
