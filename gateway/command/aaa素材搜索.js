const { SlashCommandBuilder } = require('discord.js');
const { getAutocomplete } = require('../utils/tag_pool');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aaa素材搜索')
        .setDescription('按标签组合搜索已归档的素材')
        .addStringOption(option =>
            option.setName('tags')
                .setDescription('搜索标签（用空格分隔，例如: Novel BL）')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('页码')
                .setMinValue(1)
                .setRequired(false)
        ),
    commandName: 'aaa素材搜索',

    /**
     * 标签自动补全
     */
    autocomplete: async (interaction) => {
        const focusedValue = interaction.options.getFocused();
        const parts = focusedValue.split(/\s+/);
        const currentInput = parts[parts.length - 1] || '';
        const choices = getAutocomplete(currentInput);
        await interaction.respond(
            choices.map(name => ({ name, value: name }))
        );
    }
};
