const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { config } = require('../../config/config');
const { getArchiveDb } = require('../../db/archive_db');
const { extractCharacterData } = require('../../utils/char_card_parser');
const { validateTags } = require('../../utils/tag_pool');
const { sendLog } = require('../../utils/logger');

const archiveDb = getArchiveDb();

/** 从配置读取单附件大小上限（MB），默认 10MB */
function getMaxUploadBytes() {
    const mb = config.get('bot_config.archive.max_upload_size_mb');
    if (typeof mb === 'number' && mb > 0) return mb * 1024 * 1024;
    return 10 * 1024 * 1024; // 默认 10MB
}

/** 每个分片的安全大小 = 上限 - 1MB 余量 */
function getChunkSize() {
    return getMaxUploadBytes() - 1024 * 1024;
}

/**
 * 分片上传大文件到存储频道
 * @returns {{ fileUrl: string, chunkUrls: string[], storageMessageId: string }}
 */
async function uploadToStorage(storageChannel, buffer, fileName, userTag) {
    const chunkSize = getChunkSize();

    // 单个文件能放下
    if (buffer.length <= getMaxUploadBytes()) {
        const sentMsg = await storageChannel.send({
            content: `📦 ${userTag} 上传的素材`,
            files: [{ attachment: buffer, name: fileName }]
        });
        const att = sentMsg.attachments.first();
        return {
            fileUrl: att ? att.url : null,
            chunkUrls: [],
            storageMessageId: sentMsg.id
        };
    }

    // 分片上传
    const totalChunks = Math.ceil(buffer.length / chunkSize);
    const chunkUrls = [];
    const msgIds = [];

    const progressMsg = await storageChannel.send(`⏳ 正在分片上传 **${fileName}**（共 ${totalChunks} 片）...`);

    for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, buffer.length);
        const chunk = buffer.slice(start, end);
        const chunkName = `${fileName}.part${String(i + 1).padStart(2, '0')}of${totalChunks}`;

        const msg = await storageChannel.send({
            content: `📦 ${fileName} (分片 ${i + 1}/${totalChunks})`,
            files: [{ attachment: chunk, name: chunkName }]
        });

        const att = msg.attachments.first();
        if (att) {
            chunkUrls.push(att.url);
            msgIds.push(msg.id);
        }

        // 更新进度
        if ((i + 1) % 3 === 0 || i === totalChunks - 1) {
            await progressMsg.edit(`⏳ ${fileName} 分片上传 ${i + 1}/${totalChunks}...`);
        }
    }

    await progressMsg.edit(`✅ ${fileName} 分片上传完成（${totalChunks} 片）`);

    return {
        fileUrl: chunkUrls[0] || null,
        chunkUrls,
        storageMessageId: msgIds.join(',')
    };
}

module.exports = {
    commandName: 'aaa素材上传',
    requiredPermission: 0,
    execute: async (interaction) => {
        await interaction.deferReply({ flags: [64] });

        try {
            const attachment = interaction.options.getAttachment('file');
            const tagsStr = interaction.options.getString('tags');
            const rawTags = tagsStr.split(/\s+/).filter(t => t.trim().length > 0);

            // === 1. 标签校验 ===
            const { valid: validTags, invalid, suggestions } = validateTags(rawTags);
            if (validTags.length === 0) {
                return await interaction.editReply({
                    content: `❌ 没有有效的标签。请使用 \`/aaa素材搜索\` 查看支持的标签列表。\n` +
                        (invalid.length > 0 ? `无效标签: \`${invalid.join('`, `')}\`` : '')
                });
            }

            if (invalid.length > 0) {
                let warnMsg = `⚠️ 以下标签不在标签池中，已忽略: \`${invalid.join('`, `')}\``;
                for (const tag of invalid) {
                    if (suggestions[tag] && suggestions[tag].length > 0) {
                        warnMsg += `\n  「${tag}」是否想用: \`${suggestions[tag].join('`, `')}\`？`;
                    }
                }
                // 发送警告但不阻断
                await interaction.editReply({ content: warnMsg });
            }

            // === 2. 检查文件大小 ===
            const maxBytes = getMaxUploadBytes();
            if (attachment.size > maxBytes) {
                return await interaction.editReply({
                    content: `❌ 文件过大！当前限制为 ${(maxBytes / 1024 / 1024).toFixed(0)}MB，` +
                        `当前文件 ${(attachment.size / 1024 / 1024).toFixed(2)}MB。`
                });
            }

            // === 3. 下载文件 ===
            const response = await fetch(attachment.url);
            if (!response.ok) {
                return await interaction.editReply({ content: '❌ 无法下载附件，请重试。' });
            }
            const buffer = Buffer.from(await response.arrayBuffer());

            // === 4. 检测角色卡（PNG + JSON） ===
            let charName = null;
            let charData = null;
            if (attachment.name?.toLowerCase().endsWith('.png') ||
                attachment.name?.toLowerCase().endsWith('.json') ||
                attachment.contentType === 'application/json') {
                const result = extractCharacterData(buffer, attachment.name);
                if (result.name) {
                    charName = result.name;
                    charData = result.data;
                }
            }

            // === 5. 上传到存储频道 ===
            const storageChannelId = config.get('bot_config.archive.storage_channel_id');
            if (!storageChannelId) {
                return await interaction.editReply({
                    content: '❌ 系统未配置存储频道，请联系管理员在 bot_config.json 中设置 archive.storage_channel_id。'
                });
            }

            const storageChannel = await interaction.client.channels.fetch(storageChannelId);
            if (!storageChannel) {
                return await interaction.editReply({ content: '❌ 找不到存储频道，请检查配置。' });
            }

            const { fileUrl, chunkUrls, storageMessageId } = await uploadToStorage(
                storageChannel, buffer, attachment.name, interaction.user.tag
            );

            if (!fileUrl) {
                return await interaction.editReply({ content: '❌ 上传到存储频道失败。' });
            }

            // === 6. 存入数据库 ===
            const fileType = charName ? 'character_card' : (attachment.contentType || 'unknown');
            const fileRecord = await archiveDb.saveFileV2({
                file_name: attachment.name,
                file_url: fileUrl,
                storage_message_id: storageMessageId,
                storage_channel_id: storageChannelId,
                tags: validTags,
                uploader_id: interaction.user.id,
                file_size: attachment.size,
                file_type: fileType,
                chunk_urls: chunkUrls
            });

            if (charName && fileRecord && fileRecord.id) {
                const charJsonStr = charData ? JSON.stringify(charData) : '';
                await archiveDb.saveCharacterCard(fileRecord.id, charName, charJsonStr);
            }

            // === 7. 构建回复 ===
            const tagDisplay = validTags.map(t => `\`${t}\``).join(' ');
            const isChunked = chunkUrls.length > 0;

            const embed = new EmbedBuilder()
                .setColor(charName ? 0x9b59b6 : 0x2ecc71)
                .setTitle(charName ? '🎭 角色卡上传成功' : '✅ 素材上传成功')
                .setDescription(`文件 **${attachment.name}** 已归档`)
                .addFields(
                    { name: '🏷️ 标签', value: tagDisplay || '无', inline: false },
                    { name: '📁 文件名', value: attachment.name, inline: true },
                    { name: '📦 大小', value: `${(attachment.size / 1024 / 1024).toFixed(2)} MB`, inline: true }
                )
                .setTimestamp();

            if (isChunked) {
                embed.addFields({ name: '🔗 分片', value: `共 ${chunkUrls.length} 片`, inline: true });
                embed.setFooter({ text: '下载时需要合并所有分片' });
            }

            if (charName) {
                embed.addFields({ name: '🎭 角色名', value: `**${charName}**`, inline: false });
            }

            const components = [];
            if (!isChunked) {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('📎 查看文件')
                        .setStyle(ButtonStyle.Link)
                        .setURL(fileUrl)
                );
                components.push(row);
            }

            const replyMsg = { embeds: [embed], components: components.length > 0 ? components : undefined };

            if (invalid.length > 0) {
                // If we already sent a warning via editReply, follow up with the result
                await interaction.followUp(replyMsg);
            } else {
                await interaction.editReply(replyMsg);
            }

            sendLog(interaction.client, 'success', {
                module: '归档系统',
                operation: '素材上传',
                message: `用户 ${interaction.user.tag} 上传了 ${attachment.name} (${validTags.join(', ')})` +
                    (charName ? ` | 角色卡: ${charName}` : '') +
                    (isChunked ? ` | ${chunkUrls.length} 分片` : '')
            });

        } catch (error) {
            console.error('[upload_handler] 上传素材出错:', error);
            const reply = { content: '❌ 上传过程中发生错误: ' + error.message };
            if (interaction.deferred) {
                await interaction.editReply(reply);
            } else {
                await interaction.reply({ ...reply, flags: [64] });
            }

            sendLog(interaction.client, 'error', {
                module: '归档系统',
                operation: '素材上传',
                message: `上传失败: ${error.message}`
            });
        }
    }
};
