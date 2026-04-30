import { BaseEdge, EdgeProps, Position, getBezierPath, useInternalNode, useViewport } from '@xyflow/react'
import { memo } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

type LogicalFieldEdgeData = {
  sourceFieldId?: string
  targetFieldId?: string
  onSelectEdge?: (id: string, additive: boolean) => void
}

const cssEscape = (value: string) => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}

type FieldAnchor = {
  x: number
  topY: number
  bottomY: number
}

const getFieldAnchor = (
  tableId: string,
  fieldId: string,
  nodeAbsPos: { x: number; y: number } | null | undefined,
  zoom: number
): FieldAnchor | null => {
  if (!nodeAbsPos) return null
  if (!tableId || !fieldId) return null

  const nodeSelector = `[data-logical-node-id="${cssEscape(tableId)}"]`
  const nodeEl = document.querySelector(nodeSelector) as HTMLElement | null
  const fieldSelector = `[data-logical-field-id="${cssEscape(fieldId)}"]`
  const fieldEl = nodeEl?.querySelector(fieldSelector) as HTMLElement | null
  if (!nodeEl || !fieldEl) return null

  const nodeRect = nodeEl.getBoundingClientRect()
  const fieldRect = fieldEl.getBoundingClientRect()
  const zoomSafe = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const offsetX = (fieldRect.left - nodeRect.left) / zoomSafe
  const offsetTopY = (fieldRect.top - nodeRect.top) / zoomSafe
  const fieldWidth = fieldRect.width / zoomSafe
  const fieldHeight = fieldRect.height / zoomSafe
  const topY = nodeAbsPos.y + offsetTopY
  const bottomY = topY + fieldHeight

  return {
    x: nodeAbsPos.x + offsetX + fieldWidth / 2,
    topY,
    bottomY
  }
}

function LogicalFieldEdgeInner({
  id,
  source,
  target,
  selected,
  data,
  markerEnd,
  style,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition
}: EdgeProps) {
  const { zoom } = useViewport()
  const srcNode = useInternalNode(source)
  const tgtNode = useInternalNode(target)

  const srcTable = srcNode?.data && typeof srcNode.data === 'object' ? (srcNode.data as Record<string, unknown>).table : null
  const tgtTable = tgtNode?.data && typeof tgtNode.data === 'object' ? (tgtNode.data as Record<string, unknown>).table : null

  const edgeData = (data ?? {}) as LogicalFieldEdgeData
  const srcFieldId = String(edgeData.sourceFieldId ?? '')
  const tgtFieldId = String(edgeData.targetFieldId ?? '')

  const handleEdgeClick = (event: ReactMouseEvent<SVGPathElement>) => {
    event.stopPropagation()
    edgeData.onSelectEdge?.(id, event.shiftKey)
  }

  const edgeStroke = selected ? '#2563eb' : '#111827'
  const edgeStrokeWidth = selected ? 3.2 : 2.4

  // Compute field-level positions if we have node data
  if (srcTable && tgtTable && srcNode && tgtNode) {
    const srcPos = srcNode.internals.positionAbsolute
    const tgtPos = tgtNode.internals.positionAbsolute
    const srcAnchor = getFieldAnchor(source, srcFieldId, srcPos, zoom)
    const tgtAnchor = getFieldAnchor(target, tgtFieldId, tgtPos, zoom)

    if (srcAnchor && tgtAnchor) {
      const bottomToTopDistance = Math.abs(srcAnchor.bottomY - tgtAnchor.topY)
      const topToBottomDistance = Math.abs(srcAnchor.topY - tgtAnchor.bottomY)
      const useBottomToTop = bottomToTopDistance <= topToBottomDistance

      const sx = srcAnchor.x
      const sy = useBottomToTop ? srcAnchor.bottomY : srcAnchor.topY
      const tx = tgtAnchor.x
      const ty = useBottomToTop ? tgtAnchor.topY : tgtAnchor.bottomY
      const resolvedSourcePosition = useBottomToTop ? Position.Bottom : Position.Top
      const resolvedTargetPosition = useBottomToTop ? Position.Top : Position.Bottom

      if (![sx, sy, tx, ty].every(Number.isFinite)) return null

      let edgePath = ''
      try {
        ;[edgePath] = getBezierPath({
          sourceX: sx,
          sourceY: sy,
          sourcePosition: resolvedSourcePosition,
          targetX: tx,
          targetY: ty,
          targetPosition: resolvedTargetPosition
        })
      } catch {
        // fall through to RF-provided coords
      }

      if (edgePath) {
        return (
          <g
            data-logical-edge-id={id}
            data-source-table-id={source}
            data-target-table-id={target}
            data-source-field-id={srcFieldId}
            data-target-field-id={tgtFieldId}
          >
            <path
              d={edgePath}
              fill="none"
              stroke="rgba(0,0,0,0.001)"
              strokeWidth={28}
              style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
              onClick={handleEdgeClick}
            />
            <BaseEdge
              id={id}
              path={edgePath}
              markerEnd={markerEnd}
              interactionWidth={28}
              style={{
                ...style,
                stroke: edgeStroke,
                strokeWidth: edgeStrokeWidth,
                strokeLinecap: 'round',
                strokeLinejoin: 'round'
              }}
            />
          </g>
        )
      }
    }
  }

  // Fallback: use React Flow-provided coordinates directly
  if (![sourceX, sourceY, targetX, targetY].every(Number.isFinite)) return null

  let fallbackPath = ''
  try {
    ;[fallbackPath] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition: sourcePosition ?? Position.Bottom,
      targetX,
      targetY,
      targetPosition: targetPosition ?? Position.Top
    })
  } catch {
    return null
  }

  return (
    <g
      data-logical-edge-id={id}
      data-source-table-id={source}
      data-target-table-id={target}
      data-source-field-id={srcFieldId}
      data-target-field-id={tgtFieldId}
    >
      <path
        d={fallbackPath}
        fill="none"
        stroke="rgba(0,0,0,0.001)"
        strokeWidth={28}
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        onClick={handleEdgeClick}
      />
      <BaseEdge
        id={id}
        path={fallbackPath}
        markerEnd={markerEnd}
        interactionWidth={28}
        style={{
          ...style,
          stroke: edgeStroke,
          strokeWidth: edgeStrokeWidth,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        }}
      />
    </g>
  )
}

export default memo(LogicalFieldEdgeInner)
