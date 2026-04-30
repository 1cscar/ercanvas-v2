import { ERNodeType } from '../../types'

interface ERObjectPanelProps {
  pendingType: ERNodeType | null
  onSelectType: (type: ERNodeType) => void
}

const ITEM_LIST: { type: ERNodeType; name: string; icon: string }[] = [
  { type: 'entity', name: '實體', icon: '▭' },
  { type: 'attribute', name: '屬性', icon: '◯' },
  { type: 'relationship', name: '關聯', icon: '◇' },
  { type: 'er_entity', name: '實體關聯', icon: '▭◇' }
]

export function ERObjectPanel({ pendingType, onSelectType }: ERObjectPanelProps) {
  return (
    <aside className="w-20 shrink-0 border-r border-slate-200 bg-white py-3">
      <div className="space-y-2 px-2">
        {ITEM_LIST.map((item) => {
          const active = pendingType === item.type
          return (
            <button
              key={item.type}
              type="button"
              onClick={() => onSelectType(item.type)}
              className={`flex w-full flex-col items-center rounded-md px-1 py-2 text-xs ${
                active
                  ? 'border border-slate-900 bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
              title={item.name}
            >
              <span className="mb-1 text-sm leading-none">{item.icon}</span>
              <span>{item.name}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
