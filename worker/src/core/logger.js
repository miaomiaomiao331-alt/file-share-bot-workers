/**
 * 日志频道输出（Workers 版）
 *
 * 样式与网关版 utils/logger.js 一致：级别靠 embed 左侧色条区分，
 * 顶部一行小字「级别 · 模块 · 操作」，正文即消息内容。
 * 差别只是发送方式由 discord.js 改为 REST，且失败只打控制台不抛错。
 */
import { postMessage } from '../discord_api.js';

const LEVEL_NAMES = {
    info: '信息',
    success: '成功',
    warning: '警告',
    error: '错误',
};

const LEVEL_COLORS = {
    info: 0x5865f2,
    success: 0x57f287,
    warning: 0xfee75c,
    error: 0xed4245,
};

export async function sendLog(env, level, details) {
    const { module, operation, message } = details;
    const logChannelId = env.LOG_CHANNEL_ID;

    if (!logChannelId) {
        console.log(`[logger][${level}] [${module}] ${operation}: ${message}`);
        return;
    }

    try {
        const embed = {
            author: { name: `${LEVEL_NAMES[level] || level} · ${module} · ${operation}` },
            description: message,
            color: LEVEL_COLORS[level] || 0x2b2d31,
            timestamp: new Date().toISOString(),
        };
        await postMessage(env, logChannelId, { embeds: [embed] });
    } catch (error) {
        console.error('[logger] 发送日志时出错:', error.message);
    }
}
