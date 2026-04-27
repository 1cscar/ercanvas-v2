import { BaseEdge, EdgeProps, Position, getBezierPath, useInternalNode } from '@xyflow/react'
import type { LogicalTableNodeData } from '../nodes/LogicalTableNode'

const LOGICAL_HEADER_H = 46
const LOGICAL_FIELD_H = 56
const LOGICAL_FIELD_W = 220
const PHYSICAL_HEADER_H = 56
const PHYSICAL_FIELD_H = 52

export default function LogicalFieldEdge({
  id,
  source,
  target,
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
  const srcNode = useInternalNode(source)
  const tgtNode = useInternalNode(target)

  const srcData = srcNode?.data as LogicalTableNodeData | undefined
  const tgtData = tgtNode?.data as LogicalTableNodeData | undefined
  const srcTable = srcData?.table
  const tgtTable = tgtData?.table

  const srcFieldId = String((data as Record<string, unknown>)?.sourceFieldId ?? '')
  const tgtFieldId = String((data as Record<string, unknown>)?.targetFieldId ?? '')

  // Compute field-level positions if we have node data
  if (srcTable && tgtTable && srcNode && tgtNode) {
    const srcPos = srcNode.internals.positionAbsolute
    const tgtPos = tgtNode.internals.positionAbsolute

    const srcFields = [...srcTable.fields].sort((a, b) => a.order_index - b.order_index)
    const tgtFields = [...tgtTable.fields].sort((a, b) => a.order_index - b.order_index)

    const srcIdx = Math.max(0, srcFields.findIndex((f) => f.id === srcFieldId))
    const tgtIdx = Math.max(0, tgtFields.findIndex((f) => f.id === tgtFieldId))

    let sx: number, sy: number, tx: number, ty: number

    if (srcData?.mode !== 'physical') {
      sx = srcPos.x + srcIdx * LOGICAL_FIELD_W + LOGICAL_FIELD_W / 2
      sy = srcPos.y + LOGICAL_HEADER_H + LOGICAL_FIELD_H
    } else {
      sx = srcPos.x + 180
      sy = srcPos.y + PHYSICAL_HEADER_H + srcIdx * PHYSICAL_FIELD_H + PHYSICAL_FIELD_H
    }

    if (tgtData?.mode !== 'physical') {
      tx = tgtPos.x + tgtIdx * LOGICAL_FIELD_W + LOGICAL_FIELD_W / 2
      ty = tgtPos.y + LOGICAL_HEADER_H
    } else {
      tx = tgtPos.x + 180
      ty = tgtPos.y + PHYSICAL_HEADER_H + tgtIdx * PHYSICAL_FIELD_H
    }

    if ([sx, sy, tx, ty].every(Number.isFinite)) {
      let edgePath = ''
      try {
        ;[edgePath] = getBezierPath({
          sourceX: sx,
          sourceY: sy,
          sourcePosition: Position.Bottom,
          targetX: tx,
          targetY: ty,
          targetPosition: Position.Top
        })
      } catch {
        // fall through to RF-provided coords
      }

      if (edgePath) {
        return (
          <BaseEdge
            id={id}
            path={edgePath}
            markerEnd={markerEnd}
            interactionWidth={28}
            style={{ stroke: '#111827', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', ...style }}
          />
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
    <BaseEdge
      id={id}
      path={fallbackPath}
      markerEnd={markerEnd}
      interactionWidth={28}
      style={{ stroke: '#111827', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', ...style }}
    />
  )
}
