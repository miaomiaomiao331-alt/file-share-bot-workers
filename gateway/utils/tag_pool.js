const fs = require('fs');
const path = require('path');

/**
 * tag_simple.txt 标签池加载器
 *
 * 文件格式:
 *   # 注释
 *   [分类名]
 *   Tag = 中文描述
 *   Tag = 中文描述
 */

const TAG_FILE_PATH = path.join(__dirname, '../tag_simple.txt');

let cachedTags = null;
let cachedAllTags = null;

/**
 * 加载并解析 tag_simple.txt
 * @returns {{ tags: string[], categories: { [category: string]: string[] }, all: { tag: string, desc: string, category: string }[] }}
 */
function loadTagPool() {
    if (cachedTags) return cachedTags;

    const pool = {
        tags: [],           // 所有标签名（去重）
        categories: {},     // { categoryName: [tag1, tag2, ...] }
        all: []             // [{ tag, desc, category }]
    };

    try {
        if (!fs.existsSync(TAG_FILE_PATH)) {
            console.warn('[tag_pool] tag_simple.txt 不存在:', TAG_FILE_PATH);
            cachedTags = pool;
            return pool;
        }

        const content = fs.readFileSync(TAG_FILE_PATH, 'utf-8');
        const lines = content.split(/\r?\n/);

        let currentCategory = 'Uncategorized';
        const seen = new Set();

        for (const line of lines) {
            const trimmed = line.trim();

            // 跳过空行和注释
            if (!trimmed || trimmed.startsWith('#')) continue;

            // 分类名: [CategoryName]
            const categoryMatch = trimmed.match(/^\[(.+)\]$/);
            if (categoryMatch) {
                currentCategory = categoryMatch[1];
                if (!pool.categories[currentCategory]) {
                    pool.categories[currentCategory] = [];
                }
                continue;
            }

            // Tag = Description
            const tagMatch = trimmed.match(/^(\S+)\s*=\s*(.+)$/);
            if (tagMatch) {
                const tag = tagMatch[1];
                const desc = tagMatch[2];

                pool.all.push({ tag, desc, category: currentCategory });
                pool.categories[currentCategory].push(tag);

                if (!seen.has(tag)) {
                    seen.add(tag);
                    pool.tags.push(tag);
                }
                continue;
            }

            // 裸标签（无描述）
            if (/^[A-Za-z0-9_]+$/.test(trimmed)) {
                pool.all.push({ tag: trimmed, desc: '', category: currentCategory });
                pool.categories[currentCategory].push(trimmed);
                if (!seen.has(trimmed)) {
                    seen.add(trimmed);
                    pool.tags.push(trimmed);
                }
            }
        }

        cachedTags = pool;
        console.log(`[tag_pool] ✓ 已加载 ${pool.tags.length} 个标签，${Object.keys(pool.categories).length} 个分类`);
    } catch (err) {
        console.error('[tag_pool] 加载标签池失败:', err.message);
        cachedTags = pool;
    }

    return pool;
}

/**
 * 校验标签是否在标签池中，返回 { valid: string[], invalid: string[], suggestions: { [tag]: string[] } }
 */
function validateTags(userTags) {
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
            // 找相似标签（前缀匹配）
            const similar = pool.tags
                .filter(t => t.toLowerCase().includes(cleanTag.toLowerCase()) || cleanTag.toLowerCase().includes(t.toLowerCase()))
                .slice(0, 3);
            if (similar.length > 0) {
                suggestions[cleanTag] = similar;
            }
        }
    }

    return { valid, invalid, suggestions };
}

/**
 * 获取自动补全候选项（最多 25 个）
 * @param {string} query 用户输入的部分
 * @returns {string[]}
 */
function getAutocomplete(query) {
    const pool = loadTagPool();
    if (!query || query.trim().length === 0) {
        return pool.tags.slice(0, 25);
    }

    const q = query.trim().toLowerCase();
    const matches = pool.tags.filter(t => t.toLowerCase().includes(q));
    return matches.slice(0, 25);
}

/**
 * 强制重新加载标签池
 */
function reload() {
    cachedTags = null;
    cachedAllTags = null;
    return loadTagPool();
}

module.exports = { loadTagPool, validateTags, getAutocomplete, reload };
