import { Edge, Node, ReactFlowInstance } from '@xyflow/react'

export const ZOOM_ANIMATION_MS = 160

type FlowInstance<TNode extends Node = Node, TEdge extends Edge = Edge> = ReactFlowInstance<TNode, TEdge>

export const toZoomPercent = <TNode extends Node = Node, TEdge extends Edge = Edge>(
  instance: FlowInstance<TNode, TEdge>
) => Math.round(instance.getZoom() * 100)

export const zoomInFlow = <TNode extends Node = Node, TEdge extends Edge = Edge>(
  instance: FlowInstance<TNode, TEdge> | null
) => {
  if (!instance) return
  void instance.zoomIn({ duration: ZOOM_ANIMATION_MS })
}

export const zoomOutFlow = <TNode extends Node = Node, TEdge extends Edge = Edge>(
  instance: FlowInstance<TNode, TEdge> | null
) => {
  if (!instance) return
  void instance.zoomOut({ duration: ZOOM_ANIMATION_MS })
}

type FitViewOptions = {
  padding?: number
  duration?: number
}

export const fitViewFlow = <TNode extends Node = Node, TEdge extends Edge = Edge>(
  instance: FlowInstance<TNode, TEdge> | null,
  options?: FitViewOptions
) => {
  if (!instance) return
  if (options) {
    void instance.fitView(options)
    return
  }
  void instance.fitView()
}

type RobustFitViewOptions = {
  padding: number
  duration: number
  minZoom: number
  maxZoom: number
  viewportDeltaThreshold: number
}

const DEFAULT_ROBUST_FITVIEW_OPTIONS: RobustFitViewOptions = {
  padding: 0.2,
  duration: 240,
  minZoom: 0.05,
  maxZoom: 4,
  viewportDeltaThreshold: 0.5
}

export const fitViewFlowRobust = async <TNode extends Node = Node, TEdge extends Edge = Edge>(
  instance: FlowInstance<TNode, TEdge> | null,
  options?: Partial<RobustFitViewOptions>
) => {
  if (!instance || !instance.viewportInitialized) return

  const resolved = { ...DEFAULT_ROBUST_FITVIEW_OPTIONS, ...options }
  const visibleNodes = instance.getNodes().filter((node) => !node.hidden)
  if (visibleNodes.length === 0) return

  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))

  const beforeViewport = instance.getViewport()
  try {
    await instance.fitBounds(instance.getNodesBounds(visibleNodes), {
      padding: resolved.padding,
      duration: resolved.duration
    })
  } catch {
    // fallback below
  }

  const afterViewport = instance.getViewport()
  const viewportChanged =
    Math.abs(afterViewport.x - beforeViewport.x) > resolved.viewportDeltaThreshold ||
    Math.abs(afterViewport.y - beforeViewport.y) > resolved.viewportDeltaThreshold ||
    Math.abs(afterViewport.zoom - beforeViewport.zoom) > 0.001

  if (!viewportChanged) {
    // Nudge viewport once, then retry fitBounds to avoid edge cases where first call is ignored.
    await instance.setViewport(
      {
        x: beforeViewport.x,
        y: beforeViewport.y,
        zoom: Math.max(resolved.minZoom, Math.min(resolved.maxZoom, beforeViewport.zoom * 0.9))
      },
      { duration: 0 }
    )
    await instance.fitBounds(instance.getNodesBounds(visibleNodes), {
      padding: resolved.padding,
      duration: resolved.duration
    })
  }
}
