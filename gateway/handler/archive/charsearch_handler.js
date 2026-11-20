const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getArchiveDb } = require('../../db/archive_db');

const PAGE_SIZE = 8;
const archiveDb = getArchiveDb();

module.exports = {
    commandName: 'aaa角色搜索',
    requiredPermission: 0,
    execute: async (interaction) => {
        await interaction.deferReply({ flags: 64 });

        try {
            const nameQuery = interaction.options.getString('name');
            const page = interaction.options.getInteger('page') || 1;

            if (!nameQuery || nameQuery.trim().length === 0) {
                return await interaction.editReply({ content: '❌ 请输入要搜索的角色名。' });
            }

            const result = await archiveDb.searchCharacterCards(nameQuery.trim(), page, PAGE_SIZE);

            if (result.cards.length === 0) {
                return await interaction.editReply({
                    content: `😅 没有找到角色名包含「${nameQuery}」的角色卡。`
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

            // 分页按钮
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

            await interaction.editReply({
                embeds: [embed],
                components: components.length > 0 ? components : undefined
            });

        } catch (error) {
            console.error('[charsearch_handler] 搜索角色卡出错:', error);
            const reply = { content: '❌ 搜索时发生错误: ' + error.message };
            if (interaction.deferred) {
                await interaction.editReply(reply);
            } else {
                await interaction.reply({ ...reply, flags: 64 });
            }
        }
    }
};
