/**
 * 论坛首楼文案生成
 *
 * 目标：
 *   1. 作者优先读取角色卡的 creator 字段（V2/V3 规范），其次从文本中正则提取
 *   2. 简介先清洗（去 XML 标签 / YAML 符号 / 宏），再在句子边界截断，避免残缺
 *   3. 附带卡内自带 tags，方便阅读者与自动打标签 LLM 参考
 *   4. 全文控制在 Discord 单条消息 2000 字符以内
 */

const INTRO_LIMIT = 1200;          // 简介最大长度
const MESSAGE_LIMIT = 1900;        // 首楼总长度安全上限（预留余量）

const TYPE_LABELS = {
    character: '角色卡',
    worldbook: '世界书',
    preset: '预设',
    text: '文本',
};

const TYPE_ICONS = {
    character: '📚',
    worldbook: '🌍',
    preset: '⚙️',
    text: '📄',
};

function formatForumMessage(asset) {
    const type = asset.type || 'character';
    const icon = TYPE_ICONS[type] || '📚';
    const intro = buildIntro(asset);
    const fileList = (asset.attachments || [])
        .map(a => a.filename)
        .join('\n') || '无';

    const cardTags = Array.isArray(asset.tags) && asset.tags.length > 0
        ? asset.tags.slice(0, 15).join('、')
        : '';

    let msg = `${icon} ${asset.name}\n\n`
        + `📂 类型：${TYPE_LABELS[type] || type}\n\n`;

    // 世界书/预设通常没有作者字段，仅角色卡显示作者行
    if (type === 'character') {
        const author = resolveAuthor(asset);
        msg += `👤 作者：${author || '未知'}\n\n`;
    } else if (asset.creator && String(asset.creator).trim()) {
        msg += `👤 作者：${String(asset.creator).trim()}\n\n`;
    }

    msg += `📦 文件：\n${fileList}\n\n`;

    if (cardTags) {
        const tagLabel = type === 'character' ? '卡内标签' : '标签';
        msg += `🏷️ ${tagLabel}：${cardTags}\n\n`;
    }

    const introLabel = (type === 'character' || type === 'text') ? '📝 简介：' : '📝 内容概览：';
    msg += `${introLabel}\n${intro || '（无简介内容）'}`;

    // 保险：整体不超过 Discord 单条消息上限
    if (msg.length > MESSAGE_LIMIT) {
        msg = msg.slice(0, MESSAGE_LIMIT - 3) + '……';
    }

    return msg;
}

/**
 * 解析作者：
 *   1. asset.creator（角色卡 creator 字段，由 parser 填充）
 *   2. 从描述/备注中正则提取 "作者：xxx" / "author: xxx" / "by xxx"
 */
function resolveAuthor(asset) {
    if (asset.creator && String(asset.creator).trim()) {
        return String(asset.creator).trim();
    }

    const text = [
        asset.description || '',
        asset.metadata?.characterData?.data?.creator_notes || '',
    ].join('\n');

    const patterns = [
        /作者[：:]\s*([^\n\r]{1,50})/,
        /creator[：:]\s*([^\n\r]{1,50})/i,
        /author[：:]\s*([^\n\r]{1,50})/i,
        /\bby[：:\s]+([^\n\r]{1,50})/i,
    ];

    for (const reg of patterns) {
        const m = text.match(reg);
        if (m && m[1].trim() && !/^未知$/.test(m[1].trim())) {
            return m[1].trim();
        }
    }
    return '';
}

/**
 * 生成干净的简介文本
 */
function buildIntro(asset) {
    let text = asset.description || '';
    if (!text.trim()) return '';

    text = cleanCardText(text, asset.name);

    return truncateAtBoundary(text, INTRO_LIMIT);
}

/**
 * 清洗角色卡文本：
 *   - 去掉 <xxx> / </xxx> 这类 XML 包裹标签（保留内容）
 *   - 去掉 YAML 的 "|" 折行符号
 *   - 替换 {{user}} / {{char}} 宏
 *   - 压缩多余空行与空白
 */
function cleanCardText(text, charName) {
    return text
        // XML 标签（如 <character_information ...> </...>）
        .replace(/<\/?[a-zA-Z_][^>]*>/g, '')
        // YAML 多行符号 "key: |" → "key:"
        .replace(/[：:]\s*\|\s*$/gm, '：')
        .replace(/^\s*\|\s*$/gm, '')
        // 常见宏
        .replace(/\{\{user\}\}/gi, '你')
        .replace(/\{\{char\}\}/gi, charName || 'TA')
        // 行首多余缩进
        .replace(/^[ \t]+/gm, '')
        // 3 个以上连续换行压缩为 2 个
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * 在句子/段落边界截断，避免半句被切断
 * 优先级：段落(\n) > 中文句号/问叹号 > 英文句号 > 逗号 > 硬截断
 */
function truncateAtBoundary(text, limit) {
    if (text.length <= limit) return text;

    const slice = text.slice(0, limit);
    const boundaries = ['\n', '。', '！', '？', '…', '. ', '，', '、'];

    // 只接受出现在后半段的边界，避免截得过短
    const minPos = Math.floor(limit * 0.5);

    for (const b of boundaries) {
        const idx = slice.lastIndexOf(b);
        if (idx >= minPos) {
            return slice.slice(0, idx + b.trim().length).trimEnd() + '\n……（内容过长已截断）';
        }
    }

    return slice.trimEnd() + '……（内容过长已截断）';
}

module.exports = {
    formatForumMessage,
};
