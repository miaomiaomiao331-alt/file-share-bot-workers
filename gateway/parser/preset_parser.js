/**
 * SillyTavern 预设（Preset）解析器
 *
 * 识别几类常见预设文件：
 *   1. 聊天补全预设（Chat Completion）— 含 prompts / prompt_order / chat_completion_source
 *   2. 指导模式模板（Instruct）      — 含 input_sequence / output_sequence
 *   3. 上下文模板（Context Template）— 含 story_string
 *   4. 文本生成采样预设（TextGen）   — 含 temp / rep_pen / sampler_order 等采样参数
 */

const Asset = require('./asset');

const PRESET_KINDS = [
    {
        kind: '聊天补全预设',
        match: (o) => Array.isArray(o.prompts) || o.prompt_order !== undefined
            || o.chat_completion_source !== undefined || o.openai_model !== undefined,
    },
    {
        kind: '指导模式模板 (Instruct)',
        match: (o) => o.input_sequence !== undefined && o.output_sequence !== undefined,
    },
    {
        kind: '上下文模板 (Context)',
        match: (o) => typeof o.story_string === 'string',
    },
    {
        kind: '采样参数预设 (TextGen)',
        match: (o) => (o.temp !== undefined || o.temperature !== undefined)
            && (o.rep_pen !== undefined || o.top_p !== undefined || o.sampler_order !== undefined),
    },
];

/**
 * 判断 JSON 对象是否为某种预设，返回类型名或 null
 */
function detectPresetKind(obj) {
    if (!obj || typeof obj !== 'object') return null;
    for (const { kind, match } of PRESET_KINDS) {
        try {
            if (match(obj)) return kind;
        } catch { /* 忽略单个规则错误 */ }
    }
    return null;
}

function isPreset(obj) {
    return detectPresetKind(obj) !== null;
}

/**
 * 收集可展示的关键参数
 */
function collectParams(obj) {
    const lines = [];
    const pick = (label, ...keys) => {
        for (const k of keys) {
            if (obj[k] !== undefined && obj[k] !== null && typeof obj[k] !== 'object') {
                lines.push(`${label}: ${obj[k]}`);
                return;
            }
        }
    };

    pick('温度 temperature', 'temperature', 'temp');
    pick('top_p', 'top_p');
    pick('top_k', 'top_k');
    pick('频率惩罚', 'frequency_penalty', 'freq_pen');
    pick('存在惩罚', 'presence_penalty');
    pick('重复惩罚', 'rep_pen', 'repetition_penalty');
    pick('最大上下文', 'openai_max_context', 'max_context', 'max_length');
    pick('最大回复', 'openai_max_tokens', 'max_tokens', 'genamt');
    pick('目标模型', 'openai_model', 'model', 'chat_completion_source');

    return lines;
}

/**
 * 解析预设文件 → Asset
 * @param {{name:string,url:string,buffer:Buffer,hash:string}} file
 * @param {object} obj - 已解析的 JSON 对象
 */
function parsePreset(file, obj) {
    const kind = detectPresetKind(obj) || '未知类型预设';
    const fileStem = file.name.replace(/\.[^/.]+$/, '');
    const name = (typeof obj.name === 'string' && obj.name.trim()) ? obj.name.trim() : fileStem;

    const parts = [`预设类型：${kind}`];

    const params = collectParams(obj);
    if (params.length > 0) {
        parts.push('关键参数：\n' + params.join('\n'));
    }

    // 聊天补全预设：列出 prompt 条目
    if (Array.isArray(obj.prompts) && obj.prompts.length > 0) {
        const MAX_LIST = 20;
        const names = obj.prompts.slice(0, MAX_LIST).map((p, i) => {
            const title = (p && (p.name || p.identifier)) || '(未命名)';
            const flag = p && p.enabled === false ? '（禁用）' : '';
            return `${i + 1}. ${title}${flag}`;
        });
        if (obj.prompts.length > MAX_LIST) {
            names.push(`……以及另外 ${obj.prompts.length - MAX_LIST} 个条目`);
        }
        parts.push(`Prompt 条目（共 ${obj.prompts.length} 个）：\n${names.join('\n')}`);
    }

    return new Asset({
        type: 'preset',
        name,
        description: parts.join('\n\n'),
        creator: '',
        tags: [],
        cover: null,
        attachments: [{ filename: file.name, url: file.url, hash: file.hash }],
        source: { filename: file.name },
        metadata: {
            presetKind: kind,
            promptCount: Array.isArray(obj.prompts) ? obj.prompts.length : 0,
        },
    });
}

module.exports = { isPreset, detectPresetKind, parsePreset };
