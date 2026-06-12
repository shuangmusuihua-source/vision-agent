#!/bin/bash
# macOS performance profiler
# Collects CPU, memory, disk, and process metrics for AI analysis.
# Usage: bash profile.sh
# Output: structured sections separated by "---SECTION---" markers

set -o pipefail

echo "---CPU---"
# Top 10 processes by CPU
ps aux --sort=-%cpu 2>/dev/null | head -11 || ps aux -r 2>/dev/null | head -11
echo ""
echo "CPU cores: $(sysctl -n hw.ncpu 2>/dev/null || echo 'unknown')"
echo "Load avg: $(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' || uptime 2>/dev/null | sed 's/.*load averages://')"

echo "---MEMORY---"
# Memory pressure
memory_pressure 2>/dev/null || echo "memory_pressure not available"
echo ""
# VM statistics
vm_stat 2>/dev/null | head -20 || echo "vm_stat not available"
echo ""
echo "Physical memory: $(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.1f GB", $1/1024/1024/1024}' || echo 'unknown')"
echo "Swap usage: $(sysctl -n vm.swapusage 2>/dev/null || echo 'unknown')"

echo "---TOP-MEMORY---"
# Top 10 processes by memory
ps aux --sort=-%mem 2>/dev/null | head -11 || ps aux -m 2>/dev/null | head -11

echo "---DISK---"
# Disk usage for main volumes
df -h / /System/Volumes/Data 2>/dev/null || df -h / 2>/dev/null
echo ""
echo "Largest directories in HOME (top 10, >100MB):"
du -sh ~/* ~/.[!.]* 2>/dev/null | sort -rh | head -10 || echo "du scan not available"

echo "---GPU---"
# GPU info if available (Apple Silicon)
system_profiler SPDisplaysDataType 2>/dev/null | grep -E "Chip Model|VRAM|Resolution|Metal" | head -10 || echo "GPU info not available"

echo "---NETWORK---"
# Active network connections summary
echo "ESTABLISHED: $(lsof -iTCP -sTCP:ESTABLISHED -nP 2>/dev/null | wc -l | tr -d ' ')"

echo "---TEMPERATURE---"
# Thermal state (Apple Silicon)
pmset -g therm 2>/dev/null || echo "thermal info not available"

echo "---BOOT---"
echo "Uptime: $(uptime 2>/dev/null | sed 's/.*up //' | sed 's/,.*//')"
echo "Last boot: $(last reboot 2>/dev/null | head -1 || echo 'unknown')"
