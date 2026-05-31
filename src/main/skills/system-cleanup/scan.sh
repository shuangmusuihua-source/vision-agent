#!/bin/bash
# macOS system cleanup scanner
# Scans common junk directories, silently skips non-existent or inaccessible ones.
# Usage: bash scan.sh
# Output: tab-separated "size<TAB>category<TAB>path" for each found directory

set -o pipefail

scan_dir() {
  local dir="$1" category="$2"
  if [ -d "$dir" ] 2>/dev/null && [ -r "$dir" ] 2>/dev/null; then
    local out
    out=$(du -sh "$dir" 2>/dev/null | head -1)
    if [ -n "$out" ]; then
      local size
      size=$(echo "$out" | awk '{print $1}')
      # Skip empty or zero-size directories
      [ "$size" = "0B" ] && return
      [ "$size" = "0" ] && return
      printf '%s\t%s\t%s\n' "$size" "$category" "${dir/#$HOME/~}"
    fi
  fi
}

# System-wide
scan_dir ~/Library/Caches "系统缓存"
scan_dir ~/Library/Logs "系统日志"
scan_dir ~/.Trash "废纸篓"

# Old downloads (>30 days)
if [ -d ~/Downloads ] 2>/dev/null; then
  count=$(find ~/Downloads -type f -mtime +30 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" -gt 0 ] 2>/dev/null; then
    size=$(find ~/Downloads -type f -mtime +30 -exec du -ch {} + 2>/dev/null | tail -1 | cut -f1)
    printf '%s\t%s\t%s\n' "${size:-0B}" "旧下载文件" "~/Downloads (${count} 个超过30天)"
  fi
fi

# Temp — only report if user-accessible and non-empty
scan_dir /tmp "临时文件"

# Dev tool caches
scan_dir ~/.npm/_cacache "npm缓存"
scan_dir ~/.cargo/registry/cache "cargo缓存"
scan_dir ~/Library/Developer/Xcode/DerivedData "Xcode构建缓存"
scan_dir ~/Library/Caches/pip "pip缓存"
scan_dir ~/.cache "通用缓存"

# Homebrew cache
scan_dir ~/Library/Caches/Homebrew "Homebrew缓存"

# Large app-specific caches (>10MB only, to reduce noise)
shopt -s nullglob
for d in ~/Library/Application\ Support/*/Cache; do
  [ -d "$d" ] || continue
  size_kb=$(du -sk "$d" 2>/dev/null | cut -f1)
  if [ "${size_kb:-0}" -gt 10240 ] 2>/dev/null; then
    appname=$(basename "$(dirname "$d")")
    printf '%s\t%s\t%s\n' "$(du -sh "$d" 2>/dev/null | cut -f1)" "应用缓存" "${appname}"
  fi
done
shopt -u nullglob
