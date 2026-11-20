# file-share-bot（Workers 版）

SillyTavern 素材归档 Bot 的 Cloudflare Workers 重构版。原仓库：sahjdl233/file_share_bot_tag（网关版）。

## 目录

- `worker/` —— 主线：Cloudflare Workers 版（Interactions + Cron 轮询，无服务器）
- `gateway/` —— 网关监听版存档：从原仓库裁剪（已移除文件分享系统与 D1 备份），
  将来想把服务放回服务器自动监听时可直接启用，与 Workers 版共用同一套数据（Supabase）

## 功能（与规划定稿一致）

| 功能 | Workers 版形态 |
| --- | --- |
| 自动导入（角色卡/世界书/预设/TXT 识别、hash 查重、分论坛发帖、自动打标签） | `/aaa导入` 命令附带文件；或图床频道轮询自动处理 |
| 图床频道入库 | Cron 每 5 分钟轮询图床的 Discord 存储频道，新文件照单全收、按类型分发 |
| 素材上传 / 素材搜索 / 角色搜索 | `/aaa素材上传` `/aaa素材搜索` `/aaa角色搜索`，数据统一存 Supabase |
| 换 API 面板 | `/aaa更换api`，样式与原版一致，配置存 Supabase |
| 图床异地备份 | 导入成功后备份一份到 CloudFlare-ImgBed（配置 IMGBED_URL 后启用） |
| 日志频道 | 与原版相同的极简 embed 日志 |

已移除（原网关版的）：文件分享系统整套（发布/获取/查询/移除作品、点赞解锁、提取码、
下载统计、发帖自动面板）、D1 备份/恢复、本地 SQLite 与本地 JSON 缓存。

## 数据层

只剩 Supabase 一本账：

- `assets` / `attachments`：自动导入（沿用现有表）
- `archive_files` / `character_cards`：归档素材（原本地 SQLite 迁入，建表见 `worker/sql/schema.sql`）
- `api_config`：LLM 配置单行表（同上）
- `poll_state`：轮询书签（同上）

> 原版的素材搜索查的是本地 SQLite、自动导入写的是 Supabase，两本账不互通，
> 这就是「搜卡搜不到导入的卡」的原因；本版合并后消失。
> 合并口径（数据迁移时执行）：以 Supabase 为准，SQLite 独有的按 hash 去重后并入。

## 部署（Workers 版）

1. **建表**：在 Supabase 后台 SQL Editor 执行 `worker/sql/schema.sql`。
2. **填配置**：编辑 `worker/wrangler.toml` 的 `[vars]`——
   论坛频道 ID（CHARACTER_FORUM_ID 等）、轮询频道 POLL_CHANNEL_ID、SUPABASE_URL 必填；
   其余已按现行 bot_config.json 预填。
3. **标签池**：把服务器上现用的 `tag_simple.txt` 内容整份替换 `worker/src/tag_simple.txt`。
4. **密钥**（不要写进任何文件）：
   ```
   cd worker
   npx wrangler secret put DISCORD_TOKEN
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler secret put SUPABASE_KEY
   ```
   DISCORD_PUBLIC_KEY 在开发者后台 General Information 页。
5. **部署**：`npm install && npx wrangler deploy`，记下分配的 workers.dev 地址。
6. **注册命令**：`DISCORD_TOKEN=… DISCORD_APPLICATION_ID=… GUILD_ID=… npm run register`
7. **接上 Discord**：开发者后台把 Interactions Endpoint URL 填为第 5 步的地址
   （保存时 Discord 会来验活，能存上即通）。
8. **邀请 bot**：OAuth2 链接模板（权限已按功能算好）：
   `https://discord.com/oauth2/authorize?client_id=<应用ID>&scope=bot%20applications.commands&permissions=326417632320`

### Bot 权限说明

- 开发者后台的三个特权意图（消息内容/成员/在线状态）**全部不用开**——Workers 版不连网关。
  （gateway/ 监听版启用时才需要开「消息内容意图」。）
- 邀请权限整数 326417632320 包含：查看频道、发送消息、在帖子中发送消息、创建公开帖子、
  管理帖子（打标签）、附加文件、嵌入链接、读取消息历史（轮询）、添加反应（导入反馈表情）。

## 与网关版的行为差异（已知）

1. **没有零点击监听**：Discord 不给 Workers 消息事件。替代是命令附带文件 + 频道轮询（延迟 ≤5 分钟）。
2. **自动打标签只覆盖 bot 自己发的帖**：原版靠 threadCreate 事件能给任何人新发的帖打标签；
   Workers 版没有该事件，只在导入流水线内给自己发的帖打。手动发帖的自动标签不再有。
3. **素材上传的分片**：原版入口检查使分片逻辑实际走不到；本版按 README 口径放行分片，
   另设 200MB 防滥用硬上限。
4. **同名素材补发帖时**：原版因数据缺 type 字段只能回退到角色卡论坛；本版用本次解析的类型选论坛。
5. 本地 JSON 缓存取消：Supabase 为唯一账本，单次操作延迟略增，量级可忽略。
