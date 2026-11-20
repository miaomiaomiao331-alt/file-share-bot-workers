/**
 * 论坛自动打标签（Workers 版）
 *
 * 纯逻辑部分（提示词构建、本地匹配、LLM 回复解析）与网关版
 * utils/auto_tagger.js 完全一致。差别在编排：网关版靠 threadCreate
 * 事件触发、回头去抓帖子内容；Workers 版在导入流水线里发完帖后
 * 直接拿现成的标题/首楼内容算标签，再由调用方通过 REST 应用。
 */

import { callLLM, checkApiHealth, ERROR_THRESHOLD } from './llm_caller.js';

export const MAX_TAGS = 5; // Discord 限制每帖最多 5 个标签

/** 论坛频道是否启用了自动打标签（env.AUTO_TAG_CHANNELS 逗号分隔） */
export function isAutoTagEnabled(env, channelId) {
    if (!channelId) return false;
    const channels = String(env.AUTO_TAG_CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean);
    return channels.includes(channelId);
}

/**
 * 构建 LLM 提示词（与原版一致）
 */
export function buildTagPrompt(title, content, availableTags) {
    const tagList = availableTags.map(t => t.name).join(', ');
    let promptContent = content.slice(0, 2000);

    return [
        {
            role: 'system',
            content: '你是一个 Discord 论坛帖子自动分类助手。根据帖子的标题和内容，从可用标签中选择最匹配的标签。'
                + '\n'
                + '\n重要规则：'
                + '\n1. 只输出 JSON，不要包含任何思考过程、分析、markdown 或其它文字'
                + '\n2. 不要使用 <think> 标签'
                + '\n3. 输出的 JSON 必须能被直接 JSON.parse() 解析'
                + '\n4. 必须使用可用标签列表中的标签名，不要创造新标签',
        },
        {
            role: 'user',
            content: '可用标签：' + tagList
                + '\n\n帖子标题：' + title
                + '\n帖子内容：' + promptContent
                + '\n\n请以 JSON 格式回复：{"tags":["标签1","标签2"],"reasoning":"选择理由"}',
        },
    ];
}

/**
 * 本地预匹配：从首楼内容中提取「卡内标签」行，与论坛可用标签做精确/包含匹配。
 * 命中的标签直接采用，无需 LLM；剩余名额再交给 LLM 补充。（与原版一致）
 */
export function matchLocalTags(content, availableTags) {
    if (!content) return [];

    const m = content.match(/🏷️\s*卡内标签[：:]\s*([^\n]+)/);
    if (!m) return [];

    const cardTags = m[1].split(/[、,，\s]+/).map(t => t.trim()).filter(Boolean);
    const matched = new Set();

    for (const cardTag of cardTags) {
        const lower = cardTag.toLowerCase();
        let found = availableTags.find(t => t.name.toLowerCase() === lower);
        if (!found) {
            found = availableTags.find(t =>
                t.name.toLowerCase().includes(lower) || lower.includes(t.name.toLowerCase())
            );
        }
        if (found) matched.add(found.id);
    }

    return [...matched];
}

/**
 * 解析 LLM 回复中的标签（与原版一致）
 */
export function parseLLMTags(responseContent, availableTags) {
    const tagNameMap = {};
    availableTags.forEach(t => { tagNameMap[t.name.toLowerCase()] = t; });

    const matchNames = (names) => {
        if (!Array.isArray(names)) return [];
        const matched = [];
        for (const name of names) {
            const lower = name.toLowerCase();
            if (tagNameMap[lower]) {
                matched.push(tagNameMap[lower].id);
            } else {
                const found = availableTags.find(t =>
                    t.name.toLowerCase().includes(lower) || lower.includes(t.name.toLowerCase())
                );
                if (found) matched.push(found.id);
            }
        }
        return matched;
    };

    if (!responseContent) return [];

    let cleaned = responseContent
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

    const lastOpen = cleaned.lastIndexOf('{');
    if (lastOpen >= 0) {
        const candidate = cleaned.slice(lastOpen);
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && parsed.tags) return matchNames(parsed.tags);
        } catch {}
    }

    try {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed && parsed.tags) return matchNames(parsed.tags);
        }
    } catch {}

    console.error('[auto_tagger] 解析 LLM 回复失败，原始内容:', responseContent.slice(0, 400));
    return [];
}

/**
 * 计算一个帖子应打的标签（本地优先，LLM 补充；与原版编排一致）
 * @returns {Promise<{ tagIds: string[], llmExhausted?: string }>}
 */
export async function computeAutoTags(store, { title, content, availableTags }) {
    if (!availableTags || availableTags.length === 0) return { tagIds: [] };

    const localTagIds = matchLocalTags(content, availableTags);
    if (localTagIds.length >= MAX_TAGS) {
        return { tagIds: localTagIds.slice(0, MAX_TAGS) };
    }

    const apiUnavailable = await checkApiHealth(store);
    if (apiUnavailable) {
        return { tagIds: localTagIds.slice(0, MAX_TAGS) };
    }

    const messages = buildTagPrompt(title, content, availableTags);
    const result = await callLLM(store, messages);

    if (!result.success) {
        console.error('[auto_tagger] LLM 调用失败:', result.error);
        return {
            tagIds: localTagIds.slice(0, MAX_TAGS),
            llmExhausted: result.exhausted
                ? 'LLM API 已连续错误 ' + ERROR_THRESHOLD + ' 次，自动打标签功能已暂停。请使用 /aaa更换api 检查并更新 API 配置。\n最后错误: ' + result.error
                : undefined,
        };
    }

    const llmTagIds = parseLLMTags(result.content, availableTags);
    const merged = [...new Set([...localTagIds, ...llmTagIds])];
    return { tagIds: merged.slice(0, MAX_TAGS) };
}
