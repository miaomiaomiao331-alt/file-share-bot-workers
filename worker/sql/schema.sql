-- ============================================================
-- file-share-bot (Workers 版) 需要在 Supabase 新建的表
-- 在 Supabase 后台 SQL Editor 里整段执行一次即可。
--
-- 已有的 assets / attachments 两张表沿用不动（自动导入在用）。
-- 可选：attachments 若想保存图床备份外链，执行文末的 ALTER。
-- ============================================================

-- 归档素材（原本地 SQLite 的 archive_files，字段一一对应）
create table if not exists archive_files (
    id bigint generated always as identity primary key,
    file_name text not null default '',
    file_url text not null default '',
    storage_message_id text default '',
    storage_channel_id text default '',
    tags text default '[]',
    uploader_id text default '',
    upload_time timestamptz default now(),
    file_size bigint default 0,
    file_type text default '',
    chunk_urls text default ''
);

-- 角色卡索引（原本地 SQLite 的 character_cards）
create table if not exists character_cards (
    id bigint generated always as identity primary key,
    file_id bigint not null,
    character_name text not null default '',
    character_json text default ''
);

-- LLM API 配置（原本地 SQLite 的 api_config，单行 id=1）
create table if not exists api_config (
    id integer primary key,
    provider text not null default 'deepseek',
    base_url text not null default '',
    api_key text not null default '',
    model text not null default '',
    error_count integer default 0,
    last_error text default '',
    last_error_time text default '',
    updated_at text default ''
);

-- 轮询书签（图床频道读到哪条了）
create table if not exists poll_state (
    id text primary key,
    last_message_id text default '',
    updated_at text default ''
);

-- 可选：给 attachments 加图床备份外链列（不加也能跑，代码会自动降级）
-- alter table attachments add column if not exists backup_url text;
