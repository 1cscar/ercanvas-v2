import { NodeToolbar as FlowNodeToolbar, Position } from '@xyflow/react'
import { ERNodeData, ERNodeType } from '../../types'
import { useDiagramStore } from '../../store/diagramStore'

interface ERNodeToolbarProps {
  nodeId: string
  nodeType: ERNodeType
  data: ERNodeData
  selected?: boolean
}

const NODE_TYPES: { value: ERNodeType; label: string }[] = [
  { value: 'entity', label: 'Entity' },
  { value: 'attribute', label: 'Attribute' },
  { value: 'relationship', label: 'Relationship' },
  { value: 'er_entity', label: 'ER Entity' }
]

export function ERNodeToolbar({ nodeId, nodeType, data, selected }: ERNodeToolbarProps) {
  const erNodes = useDiagramStore((state) => state.erNodes)
  const erEdges = useDiagramStore((state) => state.erEdges)
  const setERNodes = useDiagramStore((state) => state.setERNodes)
  const setEREdges = useDiagramStore((state) => state.setEREdges)
  const updateERNodeData = useDiagramStore((state) => state.updateERNodeData)

  const updateType = (nextType: ERNodeType) => {
    setERNodes(
      erNodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              type: nextType
            }
          : node
      )
    )
  }

  const addNearNode = (nextType: ERNodeType) => {
    const baseNode = erNodes.find((node) => node.id === nodeId)
    if (!baseNode) return

    const newId = crypto.randomUUID()
    const nextNodeX = baseNode.position.x + (baseNode.width ?? 120) + 80
    const nextNodeY = baseNode.position.y

    setERNodes([
      ...erNodes,
      {
        id: newId,
        type: nextType,
        position: { x: nextNodeX, y: nextNodeY },
        data: {
          label: nextType.toUpperCase(),
          isPrimaryKey: false,
          fontSize: 14,
          fontBold: false,
          fontUnderline: false
        },
        width: 120,
        height: 60
      }
    ])

    setEREdges([
      ...erEdges,
      {
        id: crypto.randomUUID(),
        source: nodeId,
        sourceHandle: 'source-right',
        target: newId,
        targetHandle: 'target-left',
        type: 'erEdge'
      }
    ])
  }

  const duplicateNode = () => {
    const baseNode = erNodes.find((node) => node.id === nodeId)
    if (!baseNode) return

    setERNodes([
      ...erNodes,
      {
        ...baseNode,
        id: crypto.randomUUID(),
        position: {
          x: baseNode.position.x + 20,
          y: baseNode.position.y + 20
        }
      }
    ])
  }

  const toggleUnderline = () => {
    const nextUnderline = !data.fontUnderline
    updateERNodeData(nodeId, {
      fontUnderline: nextUnderline,
      isPrimaryKey: nodeType === 'attribute' ? nextUnderline : data.isPrimaryKey
    })
  }

  const emitConnectStart = () => {
    window.dispatchEvent(
      new CustomEvent('er-start-connect', {
        detail: { sourceId: nodeId }
      })
    )
  }

  return (
    <FlowNodeToolbar nodeId={nodeId} position={Position.Right} isVisible={Boolean(selected)}>
      <div className="flex flex-col gap-1 rounded-md border border-slate-300 bg-white p-2 shadow-lg">
        <select
          className="rounded border border-slate-300 px-2 py-1 text-xs"
          defaultValue=""
          onChange={(event) => {
            if (event.target.value) addNearNode(event.target.value as ERNodeType)
            event.target.value = ''
          }}
        >
          <option value="">＋ 新增</option>
          {NODE_TYPES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={emitConnectStart}
          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
        >
          → 連線
        </button>

        <select
          className="rounded border border-slate-300 px-2 py-1 text-xs"
          value={nodeType}
          onChange={(event) => updateType(event.target.value as ERNodeType)}
        >
          {NODE_TYPES.map((item) => (
            <option key={item.value} value={item.value}>
              ⚙ {item.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={duplicateNode}
          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
        >
          ⎘ 複製
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`rounded border px-2 py-1 text-xs font-bold ${
              data.fontBold ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'
            }`}
            onClick={() => updateERNodeData(nodeId, { fontBold: !data.fontBold })}
          >
            B
          </button>
          <button
            type="button"
            className={`rounded border px-2 py-1 text-xs underline ${
              data.fontUnderline ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'
            }`}
            onClick={toggleUnderline}
          >
            U
          </button>
          <select
            className="rounded border border-slate-300 px-2 py-1 text-xs"
            value={data.fontSize}
            onChange={(event) => updateERNodeData(nodeId, { fontSize: Number(event.target.value) })}
          >
            {[10, 12, 14, 16, 18, 24].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
    </FlowNodeToolbar>
  )
}
