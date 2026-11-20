/**
 * 归档素材存储层（Workers 版）
 *
 * 原网关版 db/archive_db.js 把 archive_files / character_cards 两张表存在
 * 服务器本地 SQLite 里，与自动导入用的 Supabase 互不相通（搜卡查不到
 * 自动导入的卡就是这个原因）。Workers 版把这两张表迁进 Supabase，
 * 与 assets/attachments 共用一本账。方法签名与返回形状与原版一致，
 * 表内 tags / chunk_urls 仍存 JSON 字符串，保持消费方代码不变。
 *
 * 建表 SQL 见 worker/sql/schema.sql。
 */

export function createArchiveStore(supabase) {
    return {
        async saveFile(params) {
            return this.saveFileV2(params);
        },

        async saveFileV2(params) {
            const { file_name, file_url, storage_message_id, storage_channel_id, tags, uploader_id, file_size, file_type, chunk_urls } = params;
            const { data, error } = await supabase
                .from('archive_files')
                .insert({
                    file_name,
                    file_url,
                    storage_message_id: storage_message_id || '',
                    storage_channel_id: storage_channel_id || '',
                    tags: JSON.stringify(tags || []),
                    uploader_id,
                    upload_time: new Date().toISOString(),
                    file_size: file_size || 0,
                    file_type: file_type || '',
                    chunk_urls: chunk_urls && chunk_urls.length > 0 ? JSON.stringify(chunk_urls) : '',
                })
                .select('id')
                .single();
            if (error) throw error;
            return { id: data.id };
        },

        async saveCharacterCard(file_id, character_name, character_json) {
            const { data, error } = await supabase
                .from('character_cards')
                .insert({ file_id, character_name, character_json: character_json || '' })
                .select('id')
                .single();
            if (error) throw error;
            return { id: data.id };
        },

        /** 按标签组合搜索（与原版一致：全量拉取后在 JS 里做包含匹配） */
        async searchByTags(tagList, page = 1, pageSize = 10) {
            const offset = (page - 1) * pageSize;
            const lowerTags = tagList.map(t => t.toLowerCase());

            const { data: rows, error } = await supabase
                .from('archive_files')
                .select('*')
                .order('upload_time', { ascending: false });
            if (error) throw error;

            const filtered = (rows || []).filter(row => {
                let fileTags;
                try { fileTags = JSON.parse(row.tags); } catch { fileTags = []; }
                const lowerFileTags = fileTags.map(t => t.toLowerCase());
                return lowerTags.every(t => lowerFileTags.some(ft => ft.includes(t)));
            });

            const total = filtered.length;
            return {
                files: filtered.slice(offset, offset + pageSize),
                total,
                page,
                pageSize,
                totalPages: Math.ceil(total / pageSize) || 1,
            };
        },

        /** 按角色名模糊搜索（与原版一致：JOIN 改为在 JS 里拼） */
        async searchCharacterCards(nameQuery, page = 1, pageSize = 10) {
            const offset = (page - 1) * pageSize;
            const lowerQuery = nameQuery.toLowerCase();

            const [{ data: cards, error: e1 }, { data: files, error: e2 }] = await Promise.all([
                supabase.from('character_cards').select('*').order('character_name', { ascending: true }),
                supabase.from('archive_files').select('*'),
            ]);
            if (e1) throw e1;
            if (e2) throw e2;

            const fileById = new Map((files || []).map(f => [f.id, f]));
            const joined = [];
            for (const c of cards || []) {
                const a = fileById.get(c.file_id);
                if (!a) continue;
                joined.push({
                    ...c,
                    file_name: a.file_name,
                    file_url: a.file_url,
                    tags: a.tags,
                    uploader_id: a.uploader_id,
                    upload_time: a.upload_time,
                    file_size: a.file_size,
                    file_type: a.file_type,
                    storage_message_id: a.storage_message_id,
                    storage_channel_id: a.storage_channel_id,
                });
            }

            const filtered = joined.filter(row => row.character_name.toLowerCase().includes(lowerQuery));
            const total = filtered.length;
            return {
                cards: filtered.slice(offset, offset + pageSize),
                total,
                page,
                pageSize,
                totalPages: Math.ceil(total / pageSize) || 1,
            };
        },

        async getAllTags() {
            const { data: rows, error } = await supabase.from('archive_files').select('tags');
            if (error) throw error;
            const tagSet = new Set();
            for (const row of rows || []) {
                try {
                    JSON.parse(row.tags).forEach(t => tagSet.add(t));
                } catch {}
            }
            return [...tagSet].sort();
        },
    };
}
