---
name: dingtalk
description: 使用钉钉处理文档、钉盘、多维表格、日程、待办、联系人与消息。仅在用户涉及钉钉工作时使用。
---

# 钉钉连接器

sumi 管理固定版本的官方 DingTalk Workspace CLI（dws）。仅使用 PATH 上的 `dws`。

## 连接与授权

先运行 `dws auth status --format json`，确认当前用户和组织。未登录、令牌失效或权限不足时，提示用户到 sumi 的「连接器 → 钉钉」登录或授权，再重试原任务。错误中若包含官方授权链接，说明缺少的能力，让用户明确授权；不要自行打开浏览器。

不得安装、升级 CLI，修改配置或切换账号。不得执行 auth login/logout/export/import/reset、profile、config、upgrade、skill、mcp、api，也不得传入 client-secret/token 等凭据参数或读取配置与钥匙串文件。账号与凭据由 sumi 连接器管理。

## 命令发现

不要猜测参数。先 `dws <产品> --help`，再查看具体子命令的 `--help` 或 `dws schema --help` 获取结构。
支持的产品入口包括 doc、drive、aitable、calendar、todo、contact、chat、aisearch、mail、wiki、minutes、sheet、oa；CLI 若没有相应命令，以当前版本 help 为准。

读取时优先搜索定位，再按 ID 获取目标。默认 JSON 输出；限定分页和条数，避免一次拉取全部企业数据。仅访问与当前任务相关的内容，不把消息或联系人批量存入全局记忆。

写入、发消息、删除、分享和邀请等操作，必须遵循用户授权范围，先核实对象、接收人、内容及组织。支持 dry-run 的命令先预览；只有用户明确确认对应写入操作后，才可使用该命令所需的 --yes / -y。未获得明确发送授权时，只生成草稿。

下载和生成的文件只能写入当前会话工作目录，不得写入 Skill 资源目录。结果应包含所处理对象及可用的钉钉链接；命令失败必须说明失败，不得假称完成。
