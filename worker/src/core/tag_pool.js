/**
 * tag_simple.txt 标签池（Workers 版）
 *
 * 与网关版 utils/tag_pool.js 逻辑一致；区别是标签文件内容在打包时
 * 以文本模块形式导入（见 wrangler.toml 的 Text 规则），不再读本地磁盘。
 * 换标签池 = 替换 src/tag_simple.txt 后重新部署。
 *
 * 文件格式:
 *   # 注释
 *   [分类名]
 *   Tag = 中文描述
 */
import tagPoolText from '../tag_simple.txt';

let cachedPool = null;

export function loadTagPool() {
    if (cachedPool) return cachedPool;

    const pool = { tags: [], categories: {}, all: [] };
    const lines = String(tagPoolText || '').split(/\r?\n/);

    let currentCategory = 'Uncategorized';
    const seen = new Set();

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const categoryMatch = trimmed.match(/^\[(.+)\]$/);
        if (categoryMatch) {
            currentCategory = categoryMatch[1];
            if (!pool.categories[currentCategory]) pool.categories[currentCategory] = [];
            continue;
        }

        const tagMatch = trimmed.match(/^(\S+)\s*=\s*(.+)$/);
        if (tagMatch) {
            const tag = tagMatch[1];
            const desc = tagMatch[2];
            pool.all.push({ tag, desc, category: currentCategory });
            pool.categories[currentCategory].push(tag);
            if (!seen.has(tag)) { seen.add(tag); pool.tags.push(tag); }
            continue;
        }

        if (/^[A-Za-z0-9_]+$/.test(trimmed)) {
            pool.all.push({ tag: trimmed, desc: '', category: currentCategory });
            pool.categories[currentCategory].push(trimmed);
            if (!seen.has(trimmed)) { seen.add(trimmed); pool.tags.push(trimmed); }
        }
    }

    cachedPool = pool;
    return pool;
}

/**
 * 校验标签是否在标签池中，返回 { valid, invalid, suggestions }
 */
export function validateTags(userTags) {
    const pool = loadTagPool();
    const poolSet = new Set(pool.tags);

    const valid = [];
    const invalid = [];
    const suggestions = {};

    for (const tag of userTags) {
        const cleanTag = tag.trim();
        if (!cleanTag) continue;

        if (poolSet.has(cleanTag)) {
            valid.push(cleanTag);
        } else {
            invalid.push(cleanTag);
            const similar = pool.tags
                .filter(t => t.toLowerCase().includes(cleanTag.toLowerCase()) || cleanTag.toLowerCase().includes(t.toLowerCase()))
                .slice(0, 3);
            if (similar.length > 0) suggestions[cleanTag] = similar;
        }
    }

    return { valid, invalid, suggestions };
}

/**
 * 获取自动补全候选项（最多 25 个）
 */
export function getAutocomplete(query) {
    const pool = loadTagPool();
    if (!query || query.trim().length === 0) {
        return pool.tags.slice(0, 25);
    }
    const q = query.trim().toLowerCase();
    return pool.tags.filter(t => t.toLowerCase().includes(q)).slice(0, 25);
}
