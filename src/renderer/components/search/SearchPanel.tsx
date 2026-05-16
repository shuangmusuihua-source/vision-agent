import { useState, useCallback, useEffect, useRef } from 'react'
import { Search, X, FileText } from 'lucide-react'
import type { SearchResult } from '../../lib/ipc'

interface SearchPanelProps {
  onOpenFile: (filePath: string) => void
  onClose: () => void
}

function SearchPanel({ onOpenFile, onClose }: SearchPanelProps): React.ReactElement {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSearch = useCallback(async () => {
    if (!keyword.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const data = await window.api.search.query(keyword.trim())
      setResults(data)
    } catch {
      setResults([])
    }
    setSearching(false)
  }, [keyword])

  // Debounced search
  useEffect(() => {
    if (!keyword.trim()) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      handleSearch()
    }, 300)
    return () => clearTimeout(timer)
  }, [keyword, handleSearch])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
    if (e.key === 'Enter') {
      handleSearch()
    }
  }, [onClose, handleSearch])

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
    <div className="search-overlay" onClick={onClose}>
      <div className="search-panel" onClick={(e) => e.stopPropagation()}>
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
          />
          {keyword && (
            <button className="search-clear-btn" onClick={() => setKeyword('')}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="search-results">
          {searching && <div className="search-loading">搜索中...</div>}
          {!searching && keyword.trim() && results.length === 0 && (
            <div className="search-empty">没有找到匹配结果</div>
          )}
          {!searching && results.map((result, idx) => (
            <div
              key={`${result.filePath}-${result.line}-${idx}`}
              className="search-result-item"
              onClick={() => {
                onOpenFile(result.filePath)
                onClose()
              }}
            >
              <FileText size={14} className="search-result-icon" />
              <div className="search-result-info">
                <span className="search-result-file">{result.fileName}</span>
                <span className="search-result-line">:{result.line}</span>
              </div>
              <div className="search-result-content">
                {highlightKeyword(result.content)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SearchPanel