/**
 * 论坛自动打标签模块
 * 监听论坛频道的新帖子，使用 LLM 自动分析内容并匹配标签
 */

const { config } = require('../config/config');
const { getApiConfigDb } = require('../db/api_config_db');
const { callLLM, checkApiHealth } = require('./llm_caller');
const { sendLog } = require('./logger');

const TAG_LLM_ERROR = 'auto_tag_error';

/**
 * 检查论坛频道是否启用了自动打标签
 */
function isAutoTagEnabled(channelId) {
    const channels = config.get('bot_config.auto_tag.enabled_channels') || [];
    return channels.includes(channelId);
}

/**
 * 获取论坛频道的可用标签列表
 */
function getAvailableTags(forumChannel) {
    if (!forumChannel.availableTags || forumChannel.availableTags.length === 0) return [];
    return forumChannel.availableTags.map(tag => ({
        id: tag.id,
        name: tag.name,
    }));
}

/**
 * 构建 LLM 提示词
 */
function buildTagPrompt(title, content, availableTags) {
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
                + '\n4. 必须使用可用标签列表中的标签名，不要创造新标签'
        },
        {
            role: 'user',
            content: '可用标签：' + tagList
                + '\n\n帖子标题：' + title
                + '\n帖子内容：' + promptContent
                + '\n\n请以 JSON 格式回复：{"tags":["标签1","标签2"],"reasoning":"选择理由"}'
        }
    ];
}

/**
 * 本地预匹配：从首楼内容中提取「卡内标签」行，与论坛可用标签做精确/包含匹配。
 * 命中的标签直接采用，无需 LLM；剩余名额再交给 LLM 补充。
 */
function matchLocalTags(content, availableTags) {
    if (!content) return [];

    const m = content.match(/🏷️\s*卡内标签[：:]\s*([^\n]+)/);
    if (!m) return [];

    const cardTags = m[1].split(/[、,，\s]+/).map(t => t.trim()).filter(Boolean);
    const matched = new Set();

    for (const cardTag of cardTags) {
        const lower = cardTag.toLowerCase();
        // 精确匹配优先
        let found = availableTags.find(t => t.name.toLowerCase() === lower);
        // 其次双向包含
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
 * 解析 LLM 回复中的标签
 */
function parseLLMTags(responseContent, availableTags) {
    // 构建标签名→ID 映射
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

    // 1. 去掉 <think> 推理块 和 markdown 标记
    let cleaned = responseContent
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

    // 2. 找最后一个 { 截取到末尾（JSON 应该在最末尾）
    //    如果 think 块里有 {}，前面的策略会被污染
    const lastOpen = cleaned.lastIndexOf('{');
    if (lastOpen >= 0) {
        const candidate = cleaned.slice(lastOpen);
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && parsed.tags) return matchNames(parsed.tags);
        } catch {}
    }

    // 3. 兜底：贪婪匹配第一对 {}
    try {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed && parsed.tags) return matchNames(parsed.tags);
        }
    } catch {}

    // 都失败了
    console.error('[auto_tagger] 解析 LLM 回复失败，原始内容:', responseContent.slice(0, 400));
    return [];
    }

/**
 * 对单个帖子执行自动打标签
 */
async function autoTagThread(thread) {
    try {
        // 检查频道配置
        if (!isAutoTagEnabled(thread.parentId)) return;

        // 检查 API 健康（不可用时仍执行本地标签匹配，只跳过 LLM）
        const apiUnavailable = await checkApiHealth();

        // 等待帖子内容就绪
        await new Promise(r => setTimeout(r, 3000));

        // 获取帖子内容
        let content = '';
        try {
            const messages = await thread.messages.fetch({ limit: 3 });
            const firstMsg = messages.last(); // 最早的（第一条）
            if (firstMsg) {
                content = firstMsg.content || '';
                // 也收集附件描述
                if (firstMsg.attachments.size > 0) {
                    const attDesc = firstMsg.attachments.map(a => '[附件: ' + a.name + ']').join(' ');
                    content += '\n' + attDesc;
                }
            }
        } catch (e) {
            console.error('[auto_tagger] 获取帖子内容失败:', e.message);
            return;
        }

        if (!content.trim() && !thread.name) {
            console.log('[auto_tagger] 帖子无内容，跳过:', thread.name);
            return;
        }

        // 获取论坛可用标签
        let availableTags = [];
        try {
            const forumChannel = thread.parent;
            if (forumChannel && forumChannel.availableTags) {
                availableTags = getAvailableTags(forumChannel);
            }
        } catch (e) {
            console.error('[auto_tagger] 获取标签列表失败:', e.message);
        }

        if (availableTags.length === 0) {
            console.log('[auto_tagger] 论坛无可用标签:', thread.parent?.name);
            return;
        }

        // Discord 限制每帖最多 5 个标签
        const MAX_TAGS = 5;

        // 先做本地匹配（卡内标签 vs 论坛标签），命中的无需 LLM
        const localTagIds = matchLocalTags(content, availableTags);
        if (localTagIds.length > 0) {
            console.log('[auto_tagger] 本地匹配到', localTagIds.length, '个标签:', thread.name);
        }

        // 本地已匹配满额，直接应用，省一次 API 调用
        if (localTagIds.length >= MAX_TAGS) {
            await applyTags(thread, localTagIds.slice(0, MAX_TAGS), availableTags);
            return;
        }

        // API 不可用：只应用本地匹配结果
        if (apiUnavailable) {
            console.log('[auto_tagger] API 不可用（' + apiUnavailable + '），仅使用本地标签:', thread.name);
            if (localTagIds.length > 0) {
                await applyTags(thread, localTagIds.slice(0, MAX_TAGS), availableTags);
            }
            return;
        }

        // 调用 LLM 补充剩余标签
        const messages = buildTagPrompt(thread.name, content, availableTags);
        const result = await callLLM(messages);

        if (!result.success) {
            console.error('[auto_tagger] LLM 调用失败:', result.error);

            // 如果 API 耗尽，发送日志警告
            if (result.exhausted) {
                sendLog(thread.client, 'error', {
                    module: '自动打标签',
                    operation: 'API 耗尽',
                    message: 'LLM API 已连续错误 ' + require('./llm_caller').ERROR_THRESHOLD
                        + ' 次，自动打标签功能已暂停。请使用 /更换api 检查并更新 API 配置。'
                        + '\n最后错误: ' + result.error
                });
            }
            // LLM 失败时，如果本地有匹配结果，至少把本地标签打上
            if (localTagIds.length > 0) {
                await applyTags(thread, localTagIds.slice(0, MAX_TAGS), availableTags);
            }
            return;
        }

        // 解析 LLM 标签，与本地匹配结果合并去重（本地结果优先）
        const llmTagIds = parseLLMTags(result.content, availableTags);
        const merged = [...new Set([...localTagIds, ...llmTagIds])];
        const tagsToApply = merged.slice(0, MAX_TAGS);

        if (tagsToApply.length === 0) {
            console.log('[auto_tagger] 未匹配到有效标签:', thread.name);
            return;
        }

        await applyTags(thread, tagsToApply, availableTags);

    } catch (e) {
        console.error('[auto_tagger] 自动打标签出错:', e.message);
    }
}

/**
 * 将标签应用到帖子并发送日志
 */
async function applyTags(thread, tagIds, availableTags) {
    try {
        await thread.setAppliedTags(tagIds, '自动打标签');
        console.log('[auto_tagger] 已为帖子 "', thread.name, '" 打标签:', tagIds.length, '个');

        sendLog(thread.client, 'success', {
            module: '自动打标签',
            operation: '标签已应用',
            message: '帖子「' + thread.name + '」已自动打上 '
                + tagIds.map(id => {
                    const tag = availableTags.find(t => t.id === id);
                    return tag ? '`' + tag.name + '`' : '';
                }).filter(Boolean).join(' ')
        });
    } catch (e) {
        console.error('[auto_tagger] 应用标签失败:', e.message);
    }
}

module.exports = { autoTagThread, isAutoTagEnabled, parseLLMTags, buildTagPrompt, matchLocalTags };
