import { BaseEdge, EdgeProps, getSmoothStepPath, Position } from '@xyflow/react'

interface LogicalFieldEdgeData {
  sourceX?: number
  sourceY?: number
  targetX?: number
  targetY?: number
  sourceFieldId?: string
  targetFieldId?: string
}

export default function LogicalFieldEdge({
  id,
  data,
  markerEnd,
  style
}: EdgeProps) {
  const edgeData = (data ?? {}) as LogicalFieldEdgeData
  const sourceX = Number(edgeData.sourceX)
  const sourceY = Number(edgeData.sourceY)
  const targetX = Number(edgeData.targetX)
  const targetY = Number(edgeData.targetY)
  if (![sourceX, sourceY, targetX, targetY].every((value) => Number.isFinite(value))) {
    return null
  }

  let edgePath = ''
  try {
    ;[edgePath] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition: Position.Bottom,
      targetX,
      targetY,
      targetPosition: Position.Top,
      borderRadius: 12
    })
  } catch {
    return null
  }

  return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
}
