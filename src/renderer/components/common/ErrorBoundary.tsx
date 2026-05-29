import { Component, type ErrorInfo, type ReactNode } from 'react'
import * as Sentry from '@sentry/electron/renderer'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onReset?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
    Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } })
  }

  reset = (): void => {
    this.props.onReset?.()
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '2rem',
          color: 'var(--color-text-secondary)',
          gap: '0.75rem',
          textAlign: 'center'
        }}>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-primary)' }}>
            组件出错
          </p>
          {this.state.error && (
            <p style={{ fontSize: '0.75rem', maxWidth: '400px', wordBreak: 'break-word' }}>
              {this.state.error.message}
            </p>
          )}
          <button
            onClick={this.reset}
            style={{
              padding: '0.375rem 1rem',
              fontSize: '0.8125rem',
              border: '1px solid var(--color-border)',
              borderRadius: '6px',
              background: 'var(--color-bg-primary)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer'
            }}
          >
            重试
          </button>
        </div>
      )
    }

    return this.props.children
  }
}