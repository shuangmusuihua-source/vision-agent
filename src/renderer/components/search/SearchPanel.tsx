import { useState, useCallback, useEffect, useRef } from 'react'
import { Search, X, FileText } from 'lucide-react'
import type { SearchResult } from '../../lib/ipc'

interface SearchPanelProps {
  onOpenFile: (filePath: string) => void
  onClose: () => void
  initialQuery?: string
}

function SearchPanel({ onOpenFile, onClose, initialQuery }: SearchPanelProps): React.ReactElement {
  const [keyword, setKeyword] = useState(initialQuery || '')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    return () => {
      const target = returnFocusRef.current
      if (target?.isConnected) target.focus()
    }
  }, [])

  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusable = el.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    el.addEventListener('keydown', handleTab)
    return () => el.removeEventListener('keydown', handleTab)
  }, [])

  const handleSearch = useCallback(async () => {
    if (!keyword.trim()) {
      setResults([])
      setSelectedIndex(-1)
      return
    }
    setSearching(true)
    try {
      const data = await window.api.search.query(keyword.trim())
      setResults(data)
      setSelectedIndex(-1)
    } catch {
      setResults([])
      setSelectedIndex(-1)
    }
    setSearching(false)
  }, [keyword])

  // Debounced search
  useEffect(() => {
    if (!keyword.trim()) {
      setResults([])
      setSelectedIndex(-1)
      return
    }
    const timer = setTimeout(() => {
      handleSearch()
    }, 300)
    return () => clearTimeout(timer)
  }, [keyword, handleSearch])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = selectedIndex >= 0 ? results[selectedIndex] : null
      if (selected) {
        onOpenFile(selected.filePath)
        onClose()
      } else {
        void handleSearch()
      }
    }
  }, [handleSearch, onClose, onOpenFile, results, selectedIndex])

  const highlightKeyword = useCallback((text: string) => {
    if (!keyword.trim()) return text
    const parts = text.split(new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === keyword.toLowerCase()
        ? <mark key={i}>{part}</mark>
        : part
    )
  }, [keyword])

  return (
    <div className="search-overlay" ref={overlayRef} onClick={(e) => { if (e.target === e.currentTarget) onClose() }} onKeyDown={(event) => { if (event.key === 'Escape' && event.target !== inputRef.current) onClose() }}>
      <div className="search-panel" role="dialog" aria-modal="true" aria-label="搜索" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <Search size={16} className="search-icon" />
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            placeholder="搜索文件内容..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-controls="search-results"
            aria-expanded={results.length > 0}
            aria-activedescendant={selectedIndex >= 0 ? `search-result-${selectedIndex}` : undefined}
          />
          {keyword && (
            <button className="search-clear-btn" onClick={() => setKeyword('')} aria-label="清空搜索">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="search-results" id="search-results" role="listbox" aria-label="搜索结果">
          {!searching && keyword.trim() && results.length > 0 && (
            <div className="search-count">{results.length} 个结果</div>
          )}
          {searching && <div className="search-loading">搜索中...</div>}
          {!searching && keyword.trim() && results.length === 0 && (
            <div className="search-empty">没有找到匹配结果，请尝试更短或不同的关键词</div>
          )}
          {!searching && results.map((result, idx) => (
            <button
              type="button"
              id={`search-result-${idx}`}
              key={`${result.filePath}-${result.line}-${idx}`}
              className={`search-result-item ${idx === selectedIndex ? 'selected' : ''}`}
              role="option"
              aria-selected={idx === selectedIndex}
              onMouseEnter={() => setSelectedIndex(idx)}
              onClick={() => {
                onOpenFile(result.filePath)
                onClose()
              }}
            >
              <FileText size={14} className="search-result-icon" />
              <div className="search-result-info">
                <div>
                  <span className="search-result-file">{result.fileName}</span>
                  <span className="search-result-line">:{result.line}</span>
                </div>
                {result.workspaceName && (
                  <span className="search-result-workspace">{result.workspaceName}</span>
                )}
              </div>
              <div className="search-result-content">
                {highlightKeyword(result.content)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SearchPanel
