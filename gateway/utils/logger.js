const { EmbedBuilder } = require('discord.js');
const { config } = require('../config/config');

/**
 * 日志频道输出（极简样式）：
 *   - 级别只靠 embed 左侧色条区分，不再使用 emoji
 *   - 顶部一行小字：级别 · 模块 · 操作
 *   - 正文即消息内容
 */

const LEVEL_NAMES = {
    info: '信息',
    success: '成功',
    warning: '警告',
    error: '错误',
};

const LEVEL_COLORS = {
    info: 0x5865f2,     // 柔和蓝
    success: 0x57f287,  // 柔和绿
    warning: 0xfee75c,  // 柔和黄
    error: 0xed4245,    // 柔和红
};

/**
 * 发送日志消息到配置的日志频道
 * @param {import('discord.js').Client} client
 * @param {string} level  - 'info' | 'success' | 'warning' | 'error'
 * @param {object} details
 * @param {string} details.module
 * @param {string} details.operation
 * @param {string} details.message
 */
async function sendLog(client, level, details) {
    const { module, operation, message } = details;
    const logChannelId = config.get('bot_config.logger.log_channel_id');

    if (!logChannelId) {
        console.log(`[logger][${level}] [${module}] ${operation}: ${message}`);
        return;
    }

    try {
        const channel = await client.channels.fetch(logChannelId).catch(() => null);
        if (!channel) {
            console.error(`[logger] 找不到日志频道，ID: ${logChannelId}`);
            return;
        }

        // 颜色优先读配置（bot_config.logger.log_levels.<level>.color），否则用内置柔和色
        const levelInfo = config.get(`bot_config.logger.log_levels.${level}`) || {};
        const color = levelInfo.color || LEVEL_COLORS[level] || 0x2b2d31;
        const levelName = LEVEL_NAMES[level] || level;

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${levelName} · ${module} · ${operation}` })
            .setDescription(message)
            .setColor(color)
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('[logger] 发送日志时出错:', error);
    }
}

module.exports = { sendLog };
