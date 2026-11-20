/**
 * 上传频道自动导入器
 *
 * 监听 IMPORT_CHANNEL_ID 的新消息，逐个附件处理：
 *   解析（角色卡/世界书/预设）→ 查重 → 发帖或追加附件 → 保存 Asset
 *
 * 每个附件独立处理，互不影响（修复了旧版遇到同名素材就 return
 * 导致同一条消息里剩余附件被跳过的 bug）。
 *
 * 处理完成后在原消息上添加表情反馈：
 *   ✅ 至少一个附件导入/追加成功
 *   🔁 至少一个附件是完全重复（hash 相同），已跳过
 *   ❌ 至少一个附件解析或导入失败
 *   ❓ 至少一个附件是不支持的格式
 */

const { parseAsset, TYPE_LABELS } = require('../parser/asset_parser');
const { sendLog } = require('../utils/logger');
const { publishAsset } = require('../publisher/forum_publisher');
const { sendAttachment } = require('../publisher/attachment_sender');
const { generateHash } = require('../utils/hash');
const { isImgBedEnabled, backupToImgBed } = require('../utils/imgbed_backup');
const {
    findByHash,
    findByIdentity,
    saveAsset,
} = require('../storage/asset_storage');

/** 生成 identity：角色卡沿用旧格式（兼容已有数据），其他类型加前缀防止跨类型撞名 */
function buildIdentity(asset) {
    const slug = (asset.name || '').toLowerCase().replace(/\s+/g, '_');
    if (!slug) return null;
    return asset.type === 'character' ? slug : `${asset.type}_${slug}`;
}

class Importer {

    constructor(client) {
        this.client = client;
    }

    start() {
        this.client.on('messageCreate', async (message) => {
            // 真正的机器人账号发言一律忽略（防止 bot 处理自己或其他 bot 发的帖子造成死循环）。
            // Webhook 转发的消息（例如图床把上传的图片通过 webhook 推回本频道）author.bot 也是 true，
            // 但 message.webhookId 存在，用它把两者区分开，webhook 消息要放行。
            if (message.author.bot && !message.webhookId) return;
            if (message.channel.id !== process.env.IMPORT_CHANNEL_ID) return;
            if (message.attachments.size === 0) return;

            const results = [];

            for (const attachment of message.attachments.values()) {
                const status = await this.processAttachment(message, attachment);
                results.push(status);
            }

            await this.reactWithSummary(message, results);
        });
    }

    /**
     * 处理单个附件
     * @returns {'success'|'appended'|'duplicate'|'failed'|'unsupported'}
     */
    async processAttachment(message, attachment) {
        try {
            console.log('[Importer]', attachment.name);

            const response = await fetch(attachment.url);
            if (!response.ok) throw new Error('附件下载失败 HTTP ' + response.status);
            const buffer = Buffer.from(await response.arrayBuffer());

            const file = {
                name: attachment.name,
                url: attachment.url,
                buffer,
                hash: generateHash(buffer),
            };

            // ---- 解析 ----
            const { asset, type } = await parseAsset(file);
            if (!asset || type === 'unknown' || type === 'unsupported') {
                console.log('[Importer] 无法识别的文件:', attachment.name, '(', type, ')');
                await sendLog(this.client, 'warning', {
                    module: 'Importer',
                    operation: '跳过文件',
                    message: `文件: ${attachment.name}\n原因: ${type === 'unsupported' ? '不支持的格式' : '无法识别为角色卡/世界书/预设'}`,
                });
                return 'unsupported';
            }

            asset.hash = file.hash;
            asset.identity = buildIdentity(asset);

            // ---- 完全重复（同 hash）：跳过 ----
            const exists = await findByHash(file.hash);
            if (exists) {
                console.log('[Importer] 已存在（hash 相同）:', exists.name);
                return 'duplicate';
            }

            // ---- 同名素材（更新版文件）：追加附件到已有帖子 ----
            const sameAsset = asset.identity ? await findByIdentity(asset.identity) : null;
            if (sameAsset) {
                console.log('[Importer] 找到同名素材:', sameAsset.name);

                if (!sameAsset.forum || !sameAsset.forum.threadId) {
                    console.log('[Importer] 已有素材缺少 forum thread，创建新帖子');
                    const thread = await publishAsset(sameAsset, message.client);
                    sameAsset.forum = { threadId: thread.id };
                }

                const thread = await message.client.channels.fetch(sameAsset.forum.threadId);
                await sendAttachment(thread, file, sameAsset);

                // 用新版文件的解析结果刷新素材内容（简介/标签可能更新了）
                sameAsset.type = asset.type;
                sameAsset.description = asset.description || sameAsset.description;
                if (Array.isArray(asset.tags) && asset.tags.length > 0) {
                    sameAsset.tags = asset.tags;
                }
                if (asset.creator) sameAsset.creator = asset.creator;

                // 关键：把新附件记录进数据库，这样它的 hash 会入库，
                // 重复上传同一个更新版文件时能被 findByHash 拦截，不会二次追加
                sameAsset.attachments = sameAsset.attachments || [];
                const alreadyRecorded = sameAsset.attachments.some(a => a.hash === file.hash);
                if (!alreadyRecorded) {
                    const newAttachment = {
                        filename: file.name,
                        url: file.url,
                        hash: file.hash,
                    };
                    const backupUrl = await this.backupFile(file);
                    if (backupUrl) newAttachment.backup_url = backupUrl;
                    sameAsset.attachments.push(newAttachment);
                }
                await saveAsset(sameAsset);

                // 同步刷新首楼简介（尽力而为，失败不影响主流程）
                await this.refreshStarterMessage(thread, sameAsset);

                return 'appended';
            }

            // ---- 全新素材：发帖 + 保存 ----
            try {
                asset.status = 'pending';
                await saveAsset(asset);

                const thread = await publishAsset(asset, message.client);
                asset.forum = { threadId: thread.id };
                await sendAttachment(thread, file, asset);

                const backupUrl = await this.backupFile(file);
                if (backupUrl && asset.attachments?.[0]) {
                    asset.attachments[0].backup_url = backupUrl;
                }

                asset.status = 'published';
                await saveAsset(asset);

                await sendLog(this.client, 'success', {
                    module: 'Importer',
                    operation: 'Asset导入',
                    message:
`文件: ${asset.source?.filename || '未知'}
名称: ${asset.identity || asset.name}
类型: ${TYPE_LABELS[asset.type] || asset.type}
状态: ${asset.status}`,
                });

                return 'success';
            } catch (error) {
                asset.status = 'failed';
                await saveAsset(asset).catch(() => {});
                throw error;
            }

        } catch (error) {
            console.error('[Importer] 导入失败:', attachment.name, error);
            await sendLog(this.client, 'error', {
                module: 'Importer',
                operation: '导入失败',
                message: `文件: ${attachment.name}\n错误: ${error.message}`,
            }).catch(() => {});
            return 'failed';
        }
    }

    /**
     * 备份文件到 ImgBed（未配置则跳过；失败只记日志，不影响主流程）
     */
    async backupFile(file) {
        if (!isImgBedEnabled()) return null;
        const backupUrl = await backupToImgBed(file);
        if (backupUrl) {
            await sendLog(this.client, 'info', {
                module: 'ImgBed',
                operation: '异地备份',
                message: `文件: ${file.name}\n外链: ${backupUrl}`,
            }).catch(() => {});
        } else {
            await sendLog(this.client, 'warning', {
                module: 'ImgBed',
                operation: '备份失败',
                message: `文件: ${file.name}（详情见控制台日志）`,
            }).catch(() => {});
        }
        return backupUrl;
    }

    /**
     * 用最新素材内容刷新帖子首楼（仅当首楼是 bot 自己发的）
     */
    async refreshStarterMessage(thread, asset) {
        try {
            const starter = await thread.fetchStarterMessage();
            if (!starter) return;
            if (starter.author.id !== thread.client.user.id) return;

            const { formatForumMessage } = require('../publisher/forum_formatter');
            const newContent = formatForumMessage(asset);
            if (starter.content !== newContent) {
                await starter.edit({ content: newContent });
                console.log('[Importer] 已刷新首楼简介:', asset.name);
            }
        } catch (e) {
            console.error('[Importer] 刷新首楼失败（不影响导入）:', e.message);
        }
    }

    /**
     * 根据各附件结果，在原消息上添加表情反馈
     */
    async reactWithSummary(message, results) {
        const emojis = [];
        if (results.includes('success') || results.includes('appended')) emojis.push('✅');
        if (results.includes('duplicate')) emojis.push('🔁');
        if (results.includes('failed')) emojis.push('❌');
        if (results.includes('unsupported')) emojis.push('❓');

        for (const emoji of emojis) {
            try {
                await message.react(emoji);
            } catch (e) {
                console.error('[Importer] 添加反馈表情失败:', e.message);
            }
        }
    }
}

module.exports = Importer;
