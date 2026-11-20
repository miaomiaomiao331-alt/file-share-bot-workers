/**
 * SillyTavern 世界书（World Info / Lorebook）解析器
 *
 * 支持两种常见格式：
 *   1. ST 导出格式:   { entries: { "0": { uid, key:[], comment, content, disable, ... } } }
 *   2. 角色书格式:    { name, description, entries: [ { keys:[], comment, content, enabled, ... } ] }
 */

import Asset from './asset.js';

/**
 * 判断一个 JSON 对象是否为世界书
 */
function isWorldbook(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (!obj.entries) return false;

    // entries 为对象（ST 导出）或数组（角色书）
    const list = Array.isArray(obj.entries)
        ? obj.entries
        : Object.values(obj.entries);

    if (list.length === 0) return Array.isArray(obj.entries) || typeof obj.entries === 'object';

    // 条目应具备世界书条目的典型字段
    const sample = list[0];
    return typeof sample === 'object' && (
        'content' in sample || 'key' in sample || 'keys' in sample || 'comment' in sample
    );
}

/**
 * 提取条目列表（统一为数组）
 */
function getEntries(obj) {
    return Array.isArray(obj.entries) ? obj.entries : Object.values(obj.entries || {});
}

/**
 * 获取单个条目的显示名：comment 优先，其次触发关键词
 */
function entryTitle(entry) {
    if (entry.comment && String(entry.comment).trim()) return String(entry.comment).trim();
    const keys = entry.key || entry.keys;
    if (Array.isArray(keys) && keys.length > 0) return keys.slice(0, 3).join(' / ');
    return '(未命名条目)';
}

/**
 * 条目是否启用
 */
function entryEnabled(entry) {
    if (typeof entry.disable === 'boolean') return !entry.disable;
    if (typeof entry.enabled === 'boolean') return entry.enabled;
    return true;
}

/**
 * 解析世界书文件 → Asset
 * @param {{name:string,url:string,buffer:Buffer,hash:string}} file
 * @param {object} obj - 已解析的 JSON 对象
 */
function parseWorldbook(file, obj) {
    const entries = getEntries(obj);
    const enabledCount = entries.filter(entryEnabled).length;
    const totalChars = entries.reduce(
        (sum, e) => sum + (typeof e.content === 'string' ? e.content.length : 0), 0
    );

    const fileStem = file.name.replace(/\.[^/.]+$/, '');
    const name = (typeof obj.name === 'string' && obj.name.trim()) ? obj.name.trim() : fileStem;

    // 条目清单（最多列 20 条）
    const MAX_LIST = 20;
    const titles = entries.slice(0, MAX_LIST).map((e, i) => {
        const flag = entryEnabled(e) ? '' : '（禁用）';
        return `${i + 1}. ${entryTitle(e)}${flag}`;
    });
    if (entries.length > MAX_LIST) {
        titles.push(`……以及另外 ${entries.length - MAX_LIST} 个条目`);
    }

    const description =
        `条目数：${entries.length}（启用 ${enabledCount}）\n`
        + `内容总量：约 ${totalChars} 字符\n\n`
        + `条目清单：\n${titles.join('\n')}`;

    return new Asset({
        type: 'worldbook',
        name,
        description,
        creator: '',
        tags: [],
        cover: null,
        attachments: [{ filename: file.name, url: file.url, hash: file.hash }],
        source: { filename: file.name },
        metadata: {
            entryCount: entries.length,
            enabledCount,
            totalChars,
        },
    });
}

export { isWorldbook, parseWorldbook };
