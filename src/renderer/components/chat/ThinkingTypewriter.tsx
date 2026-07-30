export default function ThinkingTypewriter(): React.ReactElement {
  return (
    <div className="typewriter-viewport" aria-hidden="true">
      <div className="typewriter-scale">
        <div className="typewriter">
          <div className="slide"><i /></div>
          <div className="paper" />
          <div className="keyboard" />
        </div>
      </div>
    </div>
  )
}
