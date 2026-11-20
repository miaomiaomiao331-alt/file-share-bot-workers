const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aaa角色搜索')
        .setDescription('按角色名搜索 SillyTavern 角色卡')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('角色名（支持模糊搜索）')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('页码')
                .setMinValue(1)
                .setRequired(false)
        ),
    commandName: 'aaa角色搜索',
};
