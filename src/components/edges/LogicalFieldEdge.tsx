import { BaseEdge, EdgeProps, Position, getBezierPath, useNodes } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import type { LogicalTableNodeData } from '../nodes/LogicalTableNode'

const LOGICAL_HEADER_H = 46
const LOGICAL_FIELD_H = 56
const LOGICAL_FIELD_W = 220
const PHYSICAL_HEADER_H = 56
const PHYSICAL_FIELD_H = 52

export default function LogicalFieldEdge({ id, source, target, data, markerEnd, style }: EdgeProps) {
  const nodes = useNodes() as Node<LogicalTableNodeData>[]

  const src = nodes.find((n) => n.id === source)
  const tgt = nodes.find((n) => n.id === target)
  if (!src || !tgt) return null

  const srcTable = src.data?.table
  const tgtTable = tgt.data?.table
  if (!srcTable || !tgtTable) return null

  const srcFieldId = String((data as Record<string, unknown>)?.sourceFieldId ?? '')
  const tgtFieldId = String((data as Record<string, unknown>)?.targetFieldId ?? '')

  const isPhysical = (node: Node<LogicalTableNodeData>) => node.data?.mode === 'physical'

  const srcFields = [...srcTable.fields].sort((a, b) => a.order_index - b.order_index)
  const tgtFields = [...tgtTable.fields].sort((a, b) => a.order_index - b.order_index)

  const srcIdx = Math.max(0, srcFields.findIndex((f) => f.id === srcFieldId))
  const tgtIdx = Math.max(0, tgtFields.findIndex((f) => f.id === tgtFieldId))

  const px = src.position.x
  const py = src.position.y
  const qx = tgt.position.x
  const qy = tgt.position.y

  let sx: number, sy: number, tx: number, ty: number

  if (!isPhysical(src)) {
    sx = px + srcIdx * LOGICAL_FIELD_W + LOGICAL_FIELD_W / 2
    sy = py + LOGICAL_HEADER_H + LOGICAL_FIELD_H
  } else {
    sx = px + 180
    sy = py + PHYSICAL_HEADER_H + srcIdx * PHYSICAL_FIELD_H + PHYSICAL_FIELD_H
  }

  if (!isPhysical(tgt)) {
    tx = qx + tgtIdx * LOGICAL_FIELD_W + LOGICAL_FIELD_W / 2
    ty = qy + LOGICAL_HEADER_H
  } else {
    tx = qx + 180
    ty = qy + PHYSICAL_HEADER_H + tgtIdx * PHYSICAL_FIELD_H
  }

  if (![sx, sy, tx, ty].every(Number.isFinite)) return null

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
    return null
  }

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        stroke: '#111827',
        strokeWidth: 2.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        ...style
      }}
    />
  )
}
