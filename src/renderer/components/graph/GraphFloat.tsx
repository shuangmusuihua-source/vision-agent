import { useMemo, useRef } from 'react'
import Draggable from 'react-draggable'
import { X, GripHorizontal } from 'lucide-react'
import GraphView from './GraphView'

interface GraphFloatProps {
  show: boolean
  onClose: () => void
  activeFile?: string | null
  onNodeClick: (nodeId: string, nodeType: string) => void
}

const DEFAULT_WIDTH = 650
const DEFAULT_HEIGHT = 480

function GraphFloat({ show, onClose, activeFile, onNodeClick }: GraphFloatProps): React.ReactElement | null {
  const nodeRef = useRef<HTMLDivElement>(null!)

  const defaultPos = useMemo(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    return {
      x: Math.max(20, (vw - DEFAULT_WIDTH) / 2),
      y: Math.max(40, (vh - DEFAULT_HEIGHT) / 2),
    }
  }, [])

  if (!show) return null

  return (
    <Draggable
      handle=".graph-float-header"
      defaultPosition={defaultPos}
      nodeRef={nodeRef}
    >
      <div
        ref={nodeRef}
        className="graph-float"
        style={{ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }}
      >
        <div className="graph-float-header">
          <GripHorizontal size={14} className="graph-float-grip" />
          <span className="graph-float-title">知识图谱</span>
          <button className="graph-float-close" onClick={onClose} title="关闭">
            <X size={14} />
          </button>
        </div>
        <div className="graph-float-body">
          <GraphView activeFile={activeFile} onNodeClick={onNodeClick} />
        </div>
      </div>
    </Draggable>
  )
}

export default GraphFloat
