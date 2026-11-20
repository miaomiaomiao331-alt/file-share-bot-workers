/**
 * Asset 存储层（Workers 版）
 *
 * 与网关版 storage/asset_storage.js 的区别只有一个：去掉本地 JSON 缓存
 * （data/assets_backup）——Workers 没有本地磁盘，Supabase 是唯一账本，
 * 这也是本次重构「只留 Supabase」的既定口径。函数签名与返回形状与原版一致。
 *
 * 表结构（沿用现有）：assets(id, identity, name, description, creator, cover, thread_id)
 *                     attachments(id, asset_id, filename, url, hash[, backup_url])
 */

function shapeAsset(data) {
    if (!data) return null;
    return {
        id: data.id,
        identity: data.identity,
        name: data.name,
        description: data.description,
        creator: data.creator,
        cover: data.cover,
        attachments: data.attachments || [],
        forum: { threadId: data.thread_id },
    };
}

export async function saveAsset(supabase, asset) {
    await saveToSupabase(supabase, asset);
}

export async function getAsset(supabase, id) {
    const { data, error } = await supabase
        .from('assets')
        .select('*, attachments(*)')
        .eq('id', id)
        .single();
    if (data && !error) return shapeAsset(data);
    return null;
}

export async function findByIdentity(supabase, identity) {
    const { data, error } = await supabase
        .from('assets')
        .select('*, attachments(*)')
        .eq('identity', identity)
        .limit(1)
        .maybeSingle();
    if (data && !error) return shapeAsset(data);
    return null;
}

export async function findByHash(supabase, hash) {
    const { data, error } = await supabase
        .from('attachments')
        .select('*, assets(*)')
        .eq('hash', hash)
        .limit(1)
        .maybeSingle();
    if (data && !error) return data.assets;
    return null;
}

/** 按源文件名查找（原版只查本地缓存；Workers 版改为查 attachments 表） */
export async function findBySource(supabase, filename) {
    const { data, error } = await supabase
        .from('attachments')
        .select('asset_id')
        .eq('filename', filename)
        .limit(1)
        .maybeSingle();
    if (!data || error) return null;
    return getAsset(supabase, data.asset_id);
}

async function saveToSupabase(supabase, asset) {
    const { error: assetError } = await supabase
        .from('assets')
        .upsert({
            id: asset.id,
            identity: asset.identity,
            name: asset.name,
            description: asset.description,
            creator: asset.creator,
            cover: asset.cover,
            thread_id: asset.forum?.threadId,
        });

    if (assetError) {
        console.error('[Supabase] assets 保存失败:', assetError);
        return;
    }

    // 先查该 asset 已有的附件 hash，只插入新增的，避免重复行
    // （重复行会让 findByHash 的查询多行报错，导致查重失效）
    let existingHashes = new Set();
    try {
        const { data: existRows } = await supabase
            .from('attachments')
            .select('hash')
            .eq('asset_id', asset.id);
        if (Array.isArray(existRows)) {
            existingHashes = new Set(existRows.map(r => r.hash));
        }
    } catch (e) {
        console.error('[Supabase] 查询已有附件失败:', e.message);
    }

    for (const file of asset.attachments || []) {
        if (file.hash && existingHashes.has(file.hash)) continue;

        const row = {
            asset_id: asset.id,
            filename: file.filename,
            url: file.url,
            hash: file.hash,
        };
        if (file.backup_url) row.backup_url = file.backup_url;

        let { error: fileError } = await supabase.from('attachments').insert(row);

        // 老表没有 backup_url 列时去掉该字段重试一次（不让备份外链拖垮主流程）
        if (fileError && file.backup_url) {
            delete row.backup_url;
            ({ error: fileError } = await supabase.from('attachments').insert(row));
        }

        if (fileError) {
            console.error('[Supabase] attachment 保存失败:', fileError);
        } else if (file.hash) {
            existingHashes.add(file.hash);
        }
    }
}
