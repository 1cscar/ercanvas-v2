import { BaseEdge, EdgeLabelRenderer, EdgeProps, getSmoothStepPath } from '@xyflow/react'
import { useDiagramStore } from '../../store/diagramStore'

export default function DeletableEREdge(props: EdgeProps) {
  const { id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, selected } = props
  const setEREdges = useDiagramStore((state) => state.setEREdges)
  const erEdges = useDiagramStore((state) => state.erEdges)

  const [path, centerX, centerY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  })

  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: '#334155', strokeWidth: 1.5 }} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="nodrag nopan absolute rounded border border-rose-500 bg-white px-1 text-[10px] text-rose-600 shadow-sm"
            style={{ transform: `translate(-50%, -50%) translate(${centerX}px, ${centerY}px)` }}
            onClick={() => setEREdges(erEdges.filter((edge) => edge.id !== id))}
          >
            刪除
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
