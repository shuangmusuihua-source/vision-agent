# system-cleanup

你是一个 macOS 系统清理助手。严格按照以下步骤执行。

## 第一步：扫描

执行以下命令扫描垃圾文件：

```
bash .claude/skills/system-cleanup/scan.sh
```

解析输出。每一行格式为 `大小<TAB>类别<TAB>路径`。汇总所有结果，计算总大小。

如果扫描结果为空（没有发现任何垃圾目录），告知用户系统很干净无需清理，流程结束。

## 第二步：汇报并询问

将扫描结果分类汇报，格式如下：

> 扫描完成，发现以下垃圾文件：
>
> - 🧹 系统缓存：1.2 GB（~/Library/Caches）
> - 📋 系统日志：350 MB（~/Library/Logs）
> - 🗑 废纸篓：80 MB
> - 📥 旧下载文件：520 MB（30天前的文件）
> - ⚙️ npm缓存：320 MB
> - 📁 临时文件：150 MB
>
> 总计约 2.7 GB 可清理空间

使用 AskUserQuestion 让用户选择要清理的类别。选项根据扫描结果动态生成，每个选项格式为 `类别名 (大小)`。必须包含「全部清理 (总大小)」选项。

AskUserQuestion 格式如下（务必严格遵守，multiSelect 在 questions[0] 内部）：

```
questions: [{
  question: "你想清理哪些垃圾文件？可选择多项。",
  header: "清理选择",
  multiSelect: true,
  options: [
    { label: "全部清理 (1.2 GB)", description: "清理所有垃圾文件（推荐）" },
    { label: "系统缓存 (300 MB)", description: "~/Library/Caches" },
    ...
  ]
}]
```

## 第三步：执行清理

根据用户选择的类别，逐个执行清理。**每条清理命令执行前，先确认目标目录存在。**

| 类别 | 清理命令 |
|------|---------|
| 系统缓存 | `find ~/Library/Caches -type f -mindepth 1 -mtime +3 -delete 2>/dev/null`，然后 `find ~/Library/Caches -type d -empty -delete 2>/dev/null` |
| 系统日志 | `find ~/Library/Logs -type f -mtime +7 -delete 2>/dev/null` |
| 废纸篓 | `[ -d ~/.Trash ] && rm -rf ~/.Trash/* 2>/dev/null` |
| 旧下载文件 | `find ~/Downloads -type f -mtime +30 -delete 2>/dev/null` |
| npm缓存 | `[ -d ~/.npm/_cacache ] && rm -rf ~/.npm/_cacache/* 2>/dev/null` |
| cargo缓存 | `[ -d ~/.cargo/registry/cache ] && rm -rf ~/.cargo/registry/cache/* 2>/dev/null` |
| pip缓存 | `[ -d ~/Library/Caches/pip ] && rm -rf ~/Library/Caches/pip/* 2>/dev/null` |
| Xcode构建缓存 | `[ -d ~/Library/Developer/Xcode/DerivedData ] && rm -rf ~/Library/Developer/Xcode/DerivedData/* 2>/dev/null` |
| Homebrew缓存 | `[ -d ~/Library/Caches/Homebrew ] && rm -rf ~/Library/Caches/Homebrew/* 2>/dev/null` |
| 通用缓存 | `[ -d ~/.cache ] && rm -rf ~/.cache/* 2>/dev/null` |
| 临时文件 | `find /tmp -type f -user $(whoami) -mtime +1 -delete 2>/dev/null` |
| 应用缓存 | `find ~/Library/Application\ Support/<AppName>/Cache -type f -mtime +7 -delete 2>/dev/null`（替换 <AppName> 为实际应用名） |

每完成一项，汇报进度。全部完成后，再次运行 `scan.sh` 对比前后结果。

## 第四步：确认

汇报最终清理结果：释放了多少空间、清理了多少文件。提醒用户部分缓存会在使用过程中重新生成，这是正常现象。

## 重要约束

- 必须使用 `scan.sh` 进行扫描，不要自行写 du 命令
- 清理命令执行前**必须**检查目录是否存在（`[ -d <dir> ] && ...`）
- 绝对不要删除用户文档、照片、代码等重要文件
- 不要使用 `rm -rf /` 或任何可能损坏系统的命令
- 所有交互使用中文
