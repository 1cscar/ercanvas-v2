import { BaseEdge, EdgeProps, Position, getBezierPath } from '@xyflow/react'

export default function LogicalFieldEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style
}: EdgeProps) {
  if (![sourceX, sourceY, targetX, targetY].every((value) => Number.isFinite(value))) {
    return null
  }

  let edgePath = ''
  try {
    ;[edgePath] = getBezierPath({
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
