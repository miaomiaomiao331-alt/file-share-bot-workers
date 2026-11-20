const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getArchiveDb } = require('../../db/archive_db');

const PAGE_SIZE = 8;
const archiveDb = getArchiveDb();

module.exports = {
    commandName: 'aaa素材搜索',
    requiredPermission: 0,
    execute: async (interaction) => {
        await interaction.deferReply({ flags: 64 });

        try {
            const tagsStr = interaction.options.getString('tags');
            const page = interaction.options.getInteger('page') || 1;
            const tagList = tagsStr.split(/\s+/).filter(t => t.trim().length > 0);

            if (tagList.length === 0) {
                return await interaction.editReply({ content: '❌ 请至少输入一个搜索标签。' });
            }

            const result = await archiveDb.searchByTags(tagList, page, PAGE_SIZE);

            if (result.files.length === 0) {
                return await interaction.editReply({
                    content: `😅 没有找到包含标签 \`${tagList.join('`, `')}\` 的素材。`
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

            // 分页按钮
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

            await interaction.editReply({
                embeds: [embed],
                components: components.length > 0 ? components : undefined
            });

        } catch (error) {
            console.error('[search_handler] 搜索素材出错:', error);
            const reply = { content: '❌ 搜索时发生错误: ' + error.message };
            if (interaction.deferred) {
                await interaction.editReply(reply);
            } else {
                await interaction.reply({ ...reply, flags: 64 });
            }
        }
    }
};
