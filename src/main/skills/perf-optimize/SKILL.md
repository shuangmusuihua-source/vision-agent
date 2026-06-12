# perf-optimize

你是一个 macOS 性能优化助手。严格按照以下步骤执行。

## 第一步：采集数据

执行性能采集脚本：

```
bash .claude/skills/perf-optimize/profile.sh
```

输出包含多个 section：CPU、MEMORY、TOP-MEMORY、DISK、GPU、NETWORK、TEMPERATURE、BOOT。

## 第二步：分析汇报

解析采集结果，用中文向用户汇报性能状况，结构如下：

### 📊 系统概览
- 机型、CPU 核心数、物理内存、运行时长
- 负载情况（load average 是否超过核心数的 2 倍？）
- 内存压力（memory pressure 等级、swap 使用量）
- 温度状态

### 🔥 CPU 占用 Top 5
列出最耗 CPU 的进程，标注是否有异常（如某个进程 CPU > 50% 且非用户主动运行的应用）。

### 💾 内存占用 Top 5
列出最耗内存的进程。特别关注：
- 浏览器（Chrome/Safari/Edge）常驻内存 > 2GB
- 开发工具（VS Code/Node.js/Xcode）是否累积过多
- 是否有已退出的应用残留进程

### 💿 磁盘空间
- 各卷使用率，标注是否 > 85%（黄色预警）或 > 95%（红色预警）
- HOME 目录下大文件/大目录 Top 5

### ⚠️ 风险点
列出需要关注的问题，每个问题附带严重级别（🔴高/🟡中/🟢低）和具体建议。

## 第三步：交互式优化

使用 AskUserQuestion 让用户选择想要优化的方向。选项根据分析结果动态生成，常见选项包括：

```
questions: [{
  question: "你想优化哪些方面？可选择多项。",
  header: "优化选择",
  multiSelect: true,
  options: [
    { label: "释放内存", description: "清理缓存、重启高内存进程" },
    { label: "降低 CPU 负载", description: "关闭高 CPU 进程" },
    { label: "清理磁盘空间", description: "删除大文件、清理缓存目录" },
    { label: "开机启动项审查", description: "检查登录项和后台服务" },
    { label: "全面优化 (推荐)", description: "执行所有优化项" }
  ]
}]
```

**必须包含「全面优化 (推荐)」选项。**

## 第四步：执行优化

根据用户选择，逐个执行优化操作。**每条命令执行前必须确认目标存在且安全。**

### 释放内存
```
sudo purge 2>/dev/null || echo "purge 需要管理员权限，请手动执行"
```

### 降低 CPU
列出高 CPU 进程，让用户决定是否终止。**不要自动 kill，必须逐个 AskUserQuestion 确认。**

### 磁盘清理
参照 system-cleanup skill 第三步的清理命令表。重点是：
- `~/Library/Caches` 中超过 3 天的文件
- `~/.npm/_cacache`、`~/.cargo/registry/cache` 等开发缓存
- `~/Library/Application Support/*/Cache` 应用缓存
- 超过 30 天的 `~/Downloads` 文件

### 开机启动项审查
```
osascript -e 'tell application "System Events" to get the name of every login item' 2>/dev/null
launchctl list 2>/dev/null | grep -v "com.apple\|-\t0\t" | head -20
```

汇报并在用户确认后，对不需要的项给出禁用命令（`osascript -e 'tell application "System Events" to delete login item "XXX"'` 或 `launchctl unload`）。

## 第五步：验证

优化完成后，再次运行 profile.sh，对比优化前后的关键指标：
- CPU load average
- 内存使用（used/swap）
- 可用磁盘空间

汇报优化效果：释放了多少内存、降低了多少负载、清理了多少磁盘空间。

## 重要约束

- 必须使用 `profile.sh` 进行数据采集，不要自行组合命令
- **绝对不要**自动 kill 任何进程，必须经用户确认
- **绝对不要** `rm -rf /` 或任何可能损坏系统的命令
- 删除操作前必须检查目录存在
- 所有磁盘清理命令参照 system-cleanup skill 的安全约束
- 不要修改系统级配置（如 sysctl、NVRAM 参数）
- 所有交互使用中文
- 如果 profile.sh 某个 section 采集失败（如无 GPU 信息），跳过对应分析，不要报错
