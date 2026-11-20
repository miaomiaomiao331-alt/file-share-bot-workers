const { formatForumMessage } = require('./forum_formatter');
const { sendLog } = require('../utils/logger');
const { TYPE_LABELS } = require('../parser/asset_parser');

/**
 * 按素材类型选择目标论坛频道：
 *   character → CHARACTER_FORUM_ID
 *   worldbook → WORLDBOOK_FORUM_ID（未配置则回退到 CHARACTER_FORUM_ID）
 *   preset    → PRESET_FORUM_ID  （未配置则回退到 CHARACTER_FORUM_ID）
 */
function resolveForumId(assetType) {
    const fallback = process.env.CHARACTER_FORUM_ID;
    if (assetType === 'worldbook') return process.env.WORLDBOOK_FORUM_ID || fallback;
    if (assetType === 'preset') return process.env.PRESET_FORUM_ID || fallback;
    if (assetType === 'text') return process.env.TXT_FORUM_ID || fallback;
    return fallback;
}

async function publishAsset(asset, client) {
    const forumId = resolveForumId(asset.type);
    if (!forumId) {
        throw new Error('未配置目标论坛频道（CHARACTER_FORUM_ID）');
    }

    const forum = await client.channels.fetch(forumId);
    const content = formatForumMessage(asset);

    // Discord 帖子标题硬上限 100 字符，超长会导致整个发帖被 API 拒绝
    let threadName = (asset.name || '未命名').trim();
    if (threadName.length > 100) {
        threadName = threadName.slice(0, 99) + '…';
    }

    const thread = await forum.threads.create({
        name: threadName,
        message: { content },
    });

    await sendLog(client, 'success', {
        module: 'Forum Publisher',
        operation: '创建帖子',
        message:
`类型: ${TYPE_LABELS[asset.type] || asset.type}
名称: ${asset.identity || asset.name}
Thread ID: ${thread.id}`,
    });

    return thread;
}

module.exports = { publishAsset };
