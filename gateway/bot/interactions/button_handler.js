class ButtonHandler {
    constructor() {
        this.forumCommandsHandler = require('../../handler/file_share/forum_commands_handler');
        this.uploadWizardHandler = require('../../handler/file_share/upload_wizard_handler');
        this.archiveDb = require('../../db/archive_db').getArchiveDb();
    }

    async handleInteraction(interaction) {
        if (!interaction.isButton() && !interaction.isStringSelectMenu()) {
            return false;
        }

        try {
            const customId = interaction.customId;

            // 论坛面板按钮 (fp_*)
            if (customId.startsWith('fp_')) {
                await this.forumCommandsHandler.handleButton(interaction);
                return true;
            }

            // 归档系统按钮 (archive_*)
            if (customId.startsWith('archive_')) {
                await this.handleArchiveButton(interaction);
                return true;
            }

            // 上传向导按钮 (wiz_*)
            if (customId.startsWith('wiz_')) {
                await this.uploadWizardHandler.handleButton(interaction);
                return true;
            }

            // 由本地 collector 处理的按钮，此处忽略
            if (
                customId === 'btn_captcha' ||
                customId === 'btn_confirm_terms'
            ) {
                return true;
            }

            // ===== 新增：恢复按钮处理 =====
            if (customId === 'confirm_restore') {
                const { restoreAll } = require('../backup/restore_service');
                await interaction.deferUpdate(); // 延迟响应，允许后续编辑原始消息
                await interaction.editReply({ content: '正在恢复...', components: [] });
                const count = await restoreAll();
                await interaction.editReply({ content: `恢复完成，共 ${count} 个Asset` });
                return true;
            }
            // ===== 新增结束 =====

            // 未知按钮
            if (interaction.isButton()) {
                await interaction.reply({ content: '❌ 未知的按钮操作', flags: [64] });
            }

        } catch (error) {
            console.error('[button_handler] 处理按钮交互时出错:', error);
            const reply = { content: '❌ 处理交互时发生错误，请稍后重试', flags: [64] };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
            }
        }

        return true;
    }

    // ========== 归档系统按钮处理器 ==========

    async handleArchiveButton(interaction) {
        const customId = interaction.customId;

        // 素材搜索翻页: archive_search_page:tags:page
        if (customId.startsWith('archive_search_page:')) {
            const parts = customId.split(':');
            const tagsStr = parts.slice(1, -1).join(':');
            const page = parseInt(parts[parts.length - 1]) || 1;

            const { getArchiveDb } = require('../../db/archive_db');
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

            const PAGE_SIZE = 8;
            const archiveDb = getArchiveDb();
            const tagList = tagsStr.split(/\s+/).filter(t => t.trim().length > 0);

            const result = await archiveDb.searchByTags(tagList, page, PAGE_SIZE);

            if (result.files.length === 0) {
                return await interaction.update({
                    content: `😅 没有找到包含标签 \`${tagList.join('`, `')}\` 的素材。`,
                    embeds: [],
                    components: []
                });
            }

            const embed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('🔍 素材搜索结果')
                .setDescription(`搜索标签: \`${tagList.join('`, `')}\`\n共找到 **${result.total}** 个素材 | 第 ${result.page}/${result.totalPages} 页`)
                .setTimestamp();

            for (const file of result.files) {
                let fileTags;
                try { fileTags = JSON.parse(file.tags); } catch { fileTags = []; }
                const tagDisplay = fileTags.map(t => `\`${t}\``).join(' ');
                const isCharCard = file.file_type === 'character_card';
                const typeIcon = isCharCard ? '🎭' : '📄';

                embed.addFields({
                    name: `${typeIcon} ${file.file_name}`,
                    value: [
                        `🏷️ ${tagDisplay || '无标签'}`,
                        `📦 ${(file.file_size / 1024).toFixed(1)} KB`,
                        `👤 <@${file.uploader_id}> | <t:${Math.floor(new Date(file.upload_time).getTime() / 1000)}:R>`
                    ].join('\n'),
                    inline: false
                });
            }

            const components = [];
            if (result.totalPages > 1) {
                const row = new ActionRowBuilder();
                if (result.page > 1) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`archive_search_page:${tagsStr}:${result.page - 1}`)
                            .setLabel('◀ 上一页')
                            .setStyle(ButtonStyle.Primary)
                    );
                }
                if (result.page < result.totalPages) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`archive_search_page:${tagsStr}:${result.page + 1}`)
                            .setLabel('下一页 ▶')
                            .setStyle(ButtonStyle.Primary)
                    );
                }
                if (row.components.length > 0) components.push(row);
            }

            await interaction.update({ embeds: [embed], components: components.length > 0 ? components : [] });
            return;
        }

        // 角色卡搜索翻页: archive_char_page:name:page
        if (customId.startsWith('archive_char_page:')) {
            const parts = customId.split(':');
            const nameQuery = parts.slice(1, -1).join(':');
            const page = parseInt(parts[parts.length - 1]) || 1;

            const { getArchiveDb } = require('../../db/archive_db');
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

            const PAGE_SIZE = 8;
            const archiveDb = getArchiveDb();
            const result = await archiveDb.searchCharacterCards(nameQuery, page, PAGE_SIZE);

            if (result.cards.length === 0) {
                return await interaction.update({
                    content: `😅 没有找到角色名包含「${nameQuery}」的角色卡。`,
                    embeds: [],
                    components: []
                });
            }

            const embed = new EmbedBuilder()
                .setColor(0x9b59b6)
                .setTitle('🎭 角色卡搜索结果')
                .setDescription(`搜索角色名: **${nameQuery}**\n共找到 **${result.total}** 张角色卡 | 第 ${result.page}/${result.totalPages} 页`)
                .setTimestamp();

            for (const card of result.cards) {
                let fileTags;
                try { fileTags = JSON.parse(card.tags); } catch { fileTags = []; }
                const tagDisplay = fileTags.map(t => `\`${t}\``).join(' ');

                embed.addFields({
                    name: `🎭 ${card.character_name}`,
                    value: [
                        `📁 ${card.file_name}`,
                        `🏷️ ${tagDisplay || '无标签'}`,
                        `📦 ${(card.file_size / 1024).toFixed(1)} KB`,
                        `👤 <@${card.uploader_id}> | <t:${Math.floor(new Date(card.upload_time).getTime() / 1000)}:R>`
                    ].join('\n'),
                    inline: false
                });
            }

            const components = [];
            if (result.totalPages > 1) {
                const row = new ActionRowBuilder();
                if (result.page > 1) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`archive_char_page:${nameQuery}:${result.page - 1}`)
                            .setLabel('◀ 上一页')
                            .setStyle(ButtonStyle.Primary)
                    );
                }
                if (result.page < result.totalPages) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`archive_char_page:${nameQuery}:${result.page + 1}`)
                            .setLabel('下一页 ▶')
                            .setStyle(ButtonStyle.Primary)
                    );
                }
                if (row.components.length > 0) components.push(row);
            }

            await interaction.update({ embeds: [embed], components: components.length > 0 ? components : [] });
            return;
        }

        // 未知的归档按钮
        await interaction.reply({ content: '❌ 未知的归档操作', flags: [64] });
    }
}

module.exports = ButtonHandler;