/**
 * BroadcastChannel helpers for cross-tab diagram save notifications.
 *
 * Usage:
 *   - Call `broadcastDiagramSave(diagramId)` after a successful save.
 *   - Call `initDiagramBroadcast(store)` once after the store is created
 *     to listen for notifications from other tabs.
 */

const CHANNEL_NAME = 'ercanvas:diagram-save'

interface SaveMessage {
  type: 'diagram-saved'
  diagramId: string
}

let _channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!_channel) {
    _channel = new BroadcastChannel(CHANNEL_NAME)
  }
  return _channel
}

/** Broadcast to all other tabs that a diagram was saved. */
export function broadcastDiagramSave(diagramId: string): void {
  const channel = getChannel()
  if (!channel) return
  const message: SaveMessage = { type: 'diagram-saved', diagramId }
  channel.postMessage(message)
}

interface StoreRef {
  getState: () => {
    currentDiagramId: string | null
    setStaleDataWarning: (value: boolean) => void
  }
}

/** Subscribe to save notifications from other tabs. Call once after store creation. */
export function initDiagramBroadcast(store: StoreRef): () => void {
  const channel = getChannel()
  if (!channel) return () => {}

  const handleMessage = (event: MessageEvent<SaveMessage>) => {
    if (event.data?.type !== 'diagram-saved') return
    const { currentDiagramId, setStaleDataWarning } = store.getState()
    if (event.data.diagramId === currentDiagramId) {
      setStaleDataWarning(true)
    }
  }

  channel.addEventListener('message', handleMessage)
  return () => channel.removeEventListener('message', handleMessage)
}
