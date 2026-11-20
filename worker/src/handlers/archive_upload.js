/**
 * /aaa素材上传（Workers 版）
 *
 * 与网关版 handler/archive/upload_handler.js 流程一致：标签校验 →
 * 下载附件 → 识别角色卡 → 上传到存储频道（超限自动分片）→ 入库 → 回执。
 * 差别：存储改走 Supabase 版 archive_store；交互改走 REST。
 *
 * 一处行为修正（已注明）：原版在入口按单文件上限直接拒绝大文件，
 * 使得分片逻辑永远走不到，与 README 宣称的「超限自动分片存储」矛盾。
 * Workers 版按 README 的口径放行分片，仅保留 200MB 的防滥用硬上限。
 */
import { extractCharacterData } from '../core/char_card_parser.js';
import { validateTags } from '../core/tag_pool.js';
import { sendLog } from '../core/logger.js';
import * as api from '../discord_api.js';

const HARD_LIMIT_BYTES = 200 * 1024 * 1024;

function getMaxUploadBytes(env) {
    const mb = parseInt(env.MAX_UPLOAD_MB || '10', 10);
    return (Number.isFinite(mb) && mb > 0 ? mb : 10) * 1024 * 1024;
}

function getChunkSize(env) {
    return getMaxUploadBytes(env) - 1024 * 1024;
}

/** 分片上传大文件到存储频道（与原版 uploadToStorage 一致，改走 REST） */
async function uploadToStorage(ctx, buffer, fileName, userTag) {
    const { env } = ctx;
    const storageChannelId = env.STORAGE_CHANNEL_ID;
    const chunkSize = getChunkSize(env);

    if (buffer.length <= getMaxUploadBytes(env)) {
        const sentMsg = await api.postFileMessage(env, storageChannelId, `📦 ${userTag} 上传的素材`, fileName, buffer);
        const att = sentMsg.attachments?.[0];
        return { fileUrl: att ? att.url : null, chunkUrls: [], storageMessageId: sentMsg.id };
    }

    const totalChunks = Math.ceil(buffer.length / chunkSize);
    const chunkUrls = [];
    const msgIds = [];

    const progressMsg = await api.postMessage(env, storageChannelId, {
        content: `⏳ 正在分片上传 **${fileName}**（共 ${totalChunks} 片）...`,
    });

    for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, buffer.length);
        const chunk = buffer.slice(start, end);
        const chunkName = `${fileName}.part${String(i + 1).padStart(2, '0')}of${totalChunks}`;

        const msg = await api.postFileMessage(env, storageChannelId, `📦 ${fileName} (分片 ${i + 1}/${totalChunks})`, chunkName, chunk);
        const att = msg.attachments?.[0];
        if (att) {
            chunkUrls.push(att.url);
            msgIds.push(msg.id);
        }

        if ((i + 1) % 3 === 0 || i === totalChunks - 1) {
            await api.editMessage(env, storageChannelId, progressMsg.id, {
                content: `⏳ ${fileName} 分片上传 ${i + 1}/${totalChunks}...`,
            });
        }
    }

    await api.editMessage(env, storageChannelId, progressMsg.id, {
        content: `✅ ${fileName} 分片上传完成（${totalChunks} 片）`,
    });

    return { fileUrl: chunkUrls[0] || null, chunkUrls, storageMessageId: msgIds.join(',') };
}

export async function executeArchiveUpload(ctx, interaction) {
    return {
        __deferFlags: 64,
        __run: async () => {
            const { env } = ctx;
            const user = interaction.member?.user || interaction.user;
            try {
                const options = interaction.data.options || [];
                const fileOpt = options.find(o => o.name === 'file');
                const tagsStr = options.find(o => o.name === 'tags')?.value || '';
                const attachment = interaction.data.resolved?.attachments?.[fileOpt?.value];
                if (!attachment) {
                    await api.editOriginal(env, interaction, { content: '❌ 没有收到文件，请重试。' });
                    return;
                }
                const rawTags = tagsStr.split(/\s+/).filter(t => t.trim().length > 0);

                // === 1. 标签校验 ===
                const { valid: validTags, invalid, suggestions } = validateTags(rawTags);
                if (validTags.length === 0) {
                    await api.editOriginal(env, interaction, {
                        content: `❌ 没有有效的标签。请使用 \`/aaa素材搜索\` 查看支持的标签列表。\n`
                            + (invalid.length > 0 ? `无效标签: \`${invalid.join('`, `')}\`` : ''),
                    });
                    return;
                }

                let warned = false;
                if (invalid.length > 0) {
                    let warnMsg = `⚠️ 以下标签不在标签池中，已忽略: \`${invalid.join('`, `')}\``;
                    for (const tag of invalid) {
                        if (suggestions[tag] && suggestions[tag].length > 0) {
                            warnMsg += `\n  「${tag}」是否想用: \`${suggestions[tag].join('`, `')}\`？`;
                        }
                    }
                    await api.editOriginal(env, interaction, { content: warnMsg });
                    warned = true;
                }

                // === 2. 文件大小硬上限（分片逻辑处理单文件上限以上的部分） ===
                if (attachment.size > HARD_LIMIT_BYTES) {
                    const msg = { content: `❌ 文件过大！当前硬上限为 ${HARD_LIMIT_BYTES / 1024 / 1024}MB，当前文件 ${(attachment.size / 1024 / 1024).toFixed(2)}MB。` };
                    if (warned) await api.sendFollowup(env, interaction, { ...msg, flags: 64 });
                    else await api.editOriginal(env, interaction, msg);
                    return;
                }

                // === 3. 下载文件 ===
                const response = await fetch(attachment.url);
                if (!response.ok) {
                    const msg = { content: '❌ 无法下载附件，请重试。' };
                    if (warned) await api.sendFollowup(env, interaction, { ...msg, flags: 64 });
                    else await api.editOriginal(env, interaction, msg);
                    return;
                }
                const buffer = Buffer.from(await response.arrayBuffer());

                // === 4. 检测角色卡（PNG + JSON） ===
                let charName = null;
                let charData = null;
                const lowerName = (attachment.filename || '').toLowerCase();
                if (lowerName.endsWith('.png') || lowerName.endsWith('.json') || attachment.content_type === 'application/json') {
                    const result = extractCharacterData(buffer, attachment.filename);
                    if (result.name) {
                        charName = result.name;
                        charData = result.data;
                    }
                }

                // === 5. 上传到存储频道 ===
                if (!env.STORAGE_CHANNEL_ID) {
                    const msg = { content: '❌ 系统未配置存储频道，请联系管理员设置 STORAGE_CHANNEL_ID。' };
                    if (warned) await api.sendFollowup(env, interaction, { ...msg, flags: 64 });
                    else await api.editOriginal(env, interaction, msg);
                    return;
                }

                const { fileUrl, chunkUrls, storageMessageId } = await uploadToStorage(ctx, buffer, attachment.filename, user.username);

                if (!fileUrl) {
                    const msg = { content: '❌ 上传到存储频道失败。' };
                    if (warned) await api.sendFollowup(env, interaction, { ...msg, flags: 64 });
                    else await api.editOriginal(env, interaction, msg);
                    return;
                }

                // === 6. 存入数据库（Supabase） ===
                const fileType = charName ? 'character_card' : (attachment.content_type || 'unknown');
                const fileRecord = await ctx.archive.saveFileV2({
                    file_name: attachment.filename,
                    file_url: fileUrl,
                    storage_message_id: storageMessageId,
                    storage_channel_id: env.STORAGE_CHANNEL_ID,
                    tags: validTags,
                    uploader_id: user.id,
                    file_size: attachment.size,
                    file_type: fileType,
                    chunk_urls: chunkUrls,
                });

                if (charName && fileRecord && fileRecord.id) {
                    const charJsonStr = charData ? JSON.stringify(charData) : '';
                    await ctx.archive.saveCharacterCard(fileRecord.id, charName, charJsonStr);
                }

                // === 7. 构建回复 ===
                const tagDisplay = validTags.map(t => `\`${t}\``).join(' ');
                const isChunked = chunkUrls.length > 0;

                const embed = {
                    color: charName ? 0x9b59b6 : 0x2ecc71,
                    title: charName ? '🎭 角色卡上传成功' : '✅ 素材上传成功',
                    description: `文件 **${attachment.filename}** 已归档`,
                    fields: [
                        { name: '🏷️ 标签', value: tagDisplay || '无', inline: false },
                        { name: '📁 文件名', value: attachment.filename, inline: true },
                        { name: '📦 大小', value: `${(attachment.size / 1024 / 1024).toFixed(2)} MB`, inline: true },
                    ],
                    timestamp: new Date().toISOString(),
                };
                if (isChunked) {
                    embed.fields.push({ name: '🔗 分片', value: `共 ${chunkUrls.length} 片`, inline: true });
                    embed.footer = { text: '下载时需要合并所有分片' };
                }
                if (charName) {
                    embed.fields.push({ name: '🎭 角色名', value: `**${charName}**`, inline: false });
                }

                const components = [];
                if (!isChunked) {
                    components.push({
                        type: 1,
                        components: [{ type: 2, style: 5, label: '📎 查看文件', url: fileUrl }],
                    });
                }

                const replyMsg = { embeds: [embed], components };
                if (warned) await api.sendFollowup(env, interaction, { ...replyMsg, flags: 64 });
                else await api.editOriginal(env, interaction, replyMsg);

                await sendLog(env, 'success', {
                    module: '归档系统',
                    operation: '素材上传',
                    message: `用户 ${user.username} 上传了 ${attachment.filename} (${validTags.join(', ')})`
                        + (charName ? ` | 角色卡: ${charName}` : '')
                        + (isChunked ? ` | ${chunkUrls.length} 分片` : ''),
                });

            } catch (error) {
                console.error('[upload] 上传素材出错:', error);
                await api.editOriginal(env, interaction, { content: '❌ 上传过程中发生错误: ' + error.message }).catch(() => {});
                await sendLog(env, 'error', {
                    module: '归档系统',
                    operation: '素材上传',
                    message: `上传失败: ${error.message}`,
                });
            }
        },
    };
}
