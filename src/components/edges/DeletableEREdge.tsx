import { BaseEdge, EdgeLabelRenderer, EdgeProps, getStraightPath } from '@xyflow/react'
import { useDiagramStore } from '../../store/diagramStore'

export default function DeletableEREdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, selected } = props
  const setEREdges = useDiagramStore((state) => state.setEREdges)
  const erEdges = useDiagramStore((state) => state.erEdges)

  const [path, centerX, centerY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={24}
        style={{
          stroke: selected ? '#007AFF' : '#86868b',
          strokeWidth: selected ? 2.25 : 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          transition: 'stroke 180ms ease, stroke-width 180ms ease, filter 180ms ease',
          filter: selected ? 'drop-shadow(0 1px 3px rgba(0,122,255,0.22))' : undefined
        }}
      />
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="nodrag nopan absolute flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-white text-sm leading-none text-[#86868b] shadow-[0_8px_18px_rgba(29,29,31,0.16),0_2px_6px_rgba(29,29,31,0.10)] transition-colors hover:bg-[#F5F5F7] hover:text-[#007AFF]"
            style={{ transform: `translate(-50%, -50%) translate(${centerX}px, ${centerY}px)` }}
            onClick={() => setEREdges(erEdges.filter((edge) => edge.id !== id))}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
