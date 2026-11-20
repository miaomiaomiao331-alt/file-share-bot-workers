const { SlashCommandBuilder } = require('discord.js');
const { getAutocomplete } = require('../utils/tag_pool');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aaa素材上传')
        .setDescription('上传素材文件到归档系统，支持自动识别 SillyTavern 角色卡')
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('要上传的素材文件')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('tags')
                .setDescription('标签（用空格分隔，例如: Novel BL Completed）')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    commandName: 'aaa素材上传',

    /**
     * 标签自动补全
     */
    autocomplete: async (interaction) => {
        const focusedValue = interaction.options.getFocused();
        // 只对最后一个空格后的部分做补全
        const parts = focusedValue.split(/\s+/);
        const currentInput = parts[parts.length - 1] || '';
        const choices = getAutocomplete(currentInput);
        await interaction.respond(
            choices.map(name => ({ name, value: name }))
        );
    }
};
