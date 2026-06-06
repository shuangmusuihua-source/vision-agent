declare module 'react-draggable' {
  import { ComponentType, ReactNode, MouseEvent as ReactMouseEvent } from 'react'

  export interface DraggableData {
    node: HTMLElement
    x: number
    y: number
    deltaX: number
    deltaY: number
    lastX: number
    lastY: number
  }

  export interface DraggableEvent extends ReactMouseEvent<HTMLElement> {}

  export interface DraggableProps {
    children: ReactNode
    handle?: string
    defaultPosition?: { x: number; y: number }
    position?: { x: number; y: number }
    onStart?: (e: DraggableEvent, data: DraggableData) => void
    onDrag?: (e: DraggableEvent, data: DraggableData) => void
    onStop?: (e: DraggableEvent, data: DraggableData) => void
    bounds?: string | { left: number; top: number; right: number; bottom: number }
    axis?: 'both' | 'x' | 'y'
    disabled?: boolean
    nodeRef?: React.RefObject<HTMLElement>
  }

  const Draggable: ComponentType<DraggableProps>
  export default Draggable
}
