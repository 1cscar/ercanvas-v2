import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { createDiagramInsert, rowToDiagram } from '@/domain/diagramMapper'
import { toDbDiagramType } from '@/domain/diagramTypes'

function toMs(ts) {
  if (!ts) return 0
  return new Date(ts).getTime() || 0
}

const QUERY_TIMEOUT_MS = 6000

function timeoutReject(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms)
  })
}

async function withQueryTimeout(promise, message) {
  return Promise.race([
    Promise.resolve(promise),
    timeoutReject(QUERY_TIMEOUT_MS, message),
  ])
}

export const useDiagramsStore = defineStore('diagrams', () => {
  const diagrams = ref([])
  const loading = ref(false)
  const error = ref('')

  let channel = null
  let activeUid = null
  // Incremented on every subscribe/unsubscribe so stale async results can be discarded.
  let reloadGen = 0
  // Debounce handle for realtime-triggered reloads.
  let reloadTimer = null

  async function reload(uid, gen) {
    const { data, error: queryError } = await withQueryTimeout(
      supabase
        .from('diagrams')
        .select('*')
        .eq('owner_id', uid)
        .order('updated_at', { ascending: false }),
      '載入圖表列表逾時，請稍後重試。',
    )

    // Discard result if a newer subscribe/unsubscribe has run since we started.
    if (gen !== reloadGen) return

    if (queryError) throw queryError

    diagrams.value = (data || []).map(rowToDiagram)
    error.value = ''
  }

  function scheduleReload(uid) {
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(async () => {
      // Guard: channel may have been torn down while we were waiting.
      if (activeUid !== uid) return
      const gen = reloadGen
      try {
        await reload(uid, gen)
      } catch (_) {
        // Silently swallow — the next postgres_changes event will retry.
      }
    }, 50)
  }

  async function subscribe(uid) {
    if (activeUid === uid && channel) return

    unsubscribe()
    activeUid = uid
    loading.value = true
    const gen = ++reloadGen

    try {
      await reload(uid, gen)

      // Another subscribe/unsubscribe ran while we were loading; bail out.
      if (gen !== reloadGen) return

      channel = supabase
        .channel(`diagrams:${uid}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'diagrams',
            filter: `owner_id=eq.${uid}`,
          },
          () => {
            // Stale closure guard: ignore events from a superseded subscription.
            if (activeUid !== uid) return
            scheduleReload(uid)
          },
        )
        .subscribe()
      error.value = ''
    } catch (err) {
      if (gen !== reloadGen) return
      error.value = err?.message || '載入 Supabase 圖表資料失敗。'
      throw err
    } finally {
      if (gen === reloadGen) loading.value = false
    }
  }

  function unsubscribe() {
    clearTimeout(reloadTimer)
    reloadTimer = null
    reloadGen++

    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }

    activeUid = null
    diagrams.value = []
    loading.value = false
    error.value = ''
  }

  const myDiagrams = computed(() =>
    diagrams.value
      .filter(d => !d.deletedAt)
      .sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt))
  )

  const trashedDiagrams = computed(() =>
    diagrams.value
      .filter(d => !!d.deletedAt)
      .sort((a, b) => toMs(b.deletedAt) - toMs(a.deletedAt))
  )

  async function createDiagram(uid, type) {
    const payload = createDiagramInsert(uid, type)

    const { data, error } = await withQueryTimeout(
      supabase
        .from('diagrams')
        .insert(payload)
        .select('id')
        .single(),
      '建立圖表逾時，請稍後重試。',
    )

    if (error) throw error
    return data.id
  }

  async function fetchDiagram(uid, id) {
    const { data, error } = await withQueryTimeout(
      supabase
        .from('diagrams')
        .select('*')
        .eq('owner_id', uid)
        .eq('id', id)
        .maybeSingle(),
      '讀取圖表逾時，請稍後重試。',
    )

    if (error) throw error
    if (!data) return null
    return rowToDiagram(data)
  }

  async function trash(uid, id) {
    const { error } = await withQueryTimeout(
      supabase
        .from('diagrams')
        .update({ deleted_at: new Date().toISOString() })
        .eq('owner_id', uid)
        .eq('id', id),
      '移至垃圾桶逾時，請稍後重試。',
    )

    if (error) throw error
  }

  async function restore(uid, id) {
    const { error } = await withQueryTimeout(
      supabase
        .from('diagrams')
        .update({ deleted_at: null })
        .eq('owner_id', uid)
        .eq('id', id),
      '還原圖表逾時，請稍後重試。',
    )

    if (error) throw error
  }

  async function permDelete(uid, id) {
    const { error } = await withQueryTimeout(
      supabase
        .from('diagrams')
        .delete()
        .eq('owner_id', uid)
        .eq('id', id),
      '刪除圖表逾時，請稍後重試。',
    )

    if (error) throw error
  }

  async function rename(uid, id, name) {
    const { error } = await withQueryTimeout(
      supabase
        .from('diagrams')
        .update({ name })
        .eq('owner_id', uid)
        .eq('id', id),
      '重新命名逾時，請稍後重試。',
    )

    if (error) throw error
  }

  async function saveDiagram(uid, diagram) {
    if (!diagram?.id) throw new Error('缺少圖表 ID')
    const content = diagram.content || {}
    const dbType = toDbDiagramType(diagram.type || 'er')
    const payload = {
      name: (diagram.name || '').trim() || '未命名圖表',
      diagram_type: dbType,
      content,
      linked_er_diagram_id: diagram.linkedErDiagramId ?? content.linkedErDiagramId ?? null,
      linked_lm_diagram_id: diagram.linkedLmDiagramId ?? content.linkedLmDiagramId ?? null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await withQueryTimeout(
      supabase
        .from('diagrams')
        .update(payload)
        .eq('owner_id', uid)
        .eq('id', diagram.id),
      '儲存圖表逾時，請稍後重試。',
    )

    if (error) throw error
  }

  async function trashAll(uid) {
    const ids = myDiagrams.value.map(d => d.id)
    if (!ids.length) return

    const { error } = await withQueryTimeout(
      supabase
        .from('diagrams')
        .update({ deleted_at: new Date().toISOString() })
        .eq('owner_id', uid)
        .in('id', ids),
      '批次移至垃圾桶逾時，請稍後重試。',
    )

    if (error) throw error
  }

  async function restoreAll(uid) {
    const ids = trashedDiagrams.value.map(d => d.id)
    if (!ids.length) return

    const { error } = await withQueryTimeout(
      supabase
        .from('diagrams')
        .update({ deleted_at: null })
        .eq('owner_id', uid)
        .in('id', ids),
      '批次還原逾時，請稍後重試。',
    )

    if (error) throw error
  }

  async function permDeleteAll(uid) {
    const ids = trashedDiagrams.value.map(d => d.id)
    if (!ids.length) return

    const { error } = await withQueryTimeout(
      supabase
        .from('diagrams')
        .delete()
        .eq('owner_id', uid)
        .in('id', ids),
      '批次永久刪除逾時，請稍後重試。',
    )

    if (error) throw error
  }

  return {
    diagrams,
    loading,
    error,
    myDiagrams,
    trashedDiagrams,
    subscribe,
    unsubscribe,
    createDiagram,
    fetchDiagram,
    saveDiagram,
    trash,
    restore,
    permDelete,
    rename,
    trashAll,
    restoreAll,
    permDeleteAll,
  }
})
