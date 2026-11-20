/**
 * Discord REST API 封装（Workers 版的基础设施层）
 *
 * 网关版靠 discord.js 的 client 做所有事；Workers 版没有 client，
 * 全部走 REST：Bot Token 鉴权 + fetch。只封装本项目用到的端点。
 */

const API_BASE = 'https://discord.com/api/v10';

/** 交互响应类型（Discord Interactions） */
export const InteractionResponseType = {
    PONG: 1,
    CHANNEL_MESSAGE_WITH_SOURCE: 4,
    DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
    DEFERRED_UPDATE_MESSAGE: 6,
    UPDATE_MESSAGE: 7,
    APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
    MODAL: 9,
};

export const EPHEMERAL = 64;

async function discordFetch(env, path, { method = 'GET', json, form } = {}) {
    const headers = { Authorization: 'Bot ' + env.DISCORD_TOKEN };
    let body;
    if (form) {
        body = form;
    } else if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
    }
    const res = await fetch(API_BASE + path, { method, headers, body });
    if (res.status === 204) return null;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
    if (!res.ok) {
        const err = new Error(`Discord API ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
        err.status = res.status;
        err.data = data;
        throw err;
    }
    return data;
}

/** 取频道信息（论坛频道带 available_tags） */
export function getChannel(env, channelId) {
    return discordFetch(env, `/channels/${channelId}`);
}

/** 在论坛频道发新帖（首楼内容即 message.content），返回 thread 对象 */
export function createForumThread(env, forumId, name, content) {
    return discordFetch(env, `/channels/${forumId}/threads`, {
        method: 'POST',
        json: { name, message: { content } },
    });
}

/** 发普通消息（可带 embeds / components），返回 message 对象 */
export function postMessage(env, channelId, payload) {
    return discordFetch(env, `/channels/${channelId}/messages`, { method: 'POST', json: payload });
}

/** 发带文件的消息（帖子内追加附件、存储频道存文件都用它），返回 message 对象 */
export function postFileMessage(env, channelId, content, fileName, buffer) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content: content || '' }));
    form.append('files[0]', new Blob([buffer]), fileName);
    return discordFetch(env, `/channels/${channelId}/messages`, { method: 'POST', form });
}

export function editMessage(env, channelId, messageId, payload) {
    return discordFetch(env, `/channels/${channelId}/messages/${messageId}`, { method: 'PATCH', json: payload });
}

export function deleteMessage(env, channelId, messageId) {
    return discordFetch(env, `/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
}

export function getMessage(env, channelId, messageId) {
    return discordFetch(env, `/channels/${channelId}/messages/${messageId}`);
}

/** 拉取某条消息之后的新消息（轮询用），按时间正序返回 */
export async function listMessagesAfter(env, channelId, afterId, limit = 100) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (afterId) q.set('after', afterId);
    const msgs = await discordFetch(env, `/channels/${channelId}/messages?${q.toString()}`);
    return Array.isArray(msgs) ? msgs.reverse() : [];
}

/** 给消息加表情反应 */
export function addReaction(env, channelId, messageId, emoji) {
    return discordFetch(env, `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, { method: 'PUT' });
}

/** 修改帖子（打标签用 applied_tags） */
export function patchThread(env, threadId, patch) {
    return discordFetch(env, `/channels/${threadId}`, { method: 'PATCH', json: patch });
}

/** 编辑交互的原始回复（defer 之后用它交结果） */
export function editOriginal(env, interaction, payload) {
    return discordFetch(env, `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, { method: 'PATCH', json: payload });
}

/** 发送一条新的 followup 消息 */
export function sendFollowup(env, interaction, payload) {
    return discordFetch(env, `/webhooks/${interaction.application_id}/${interaction.token}`, { method: 'POST', json: payload });
}
