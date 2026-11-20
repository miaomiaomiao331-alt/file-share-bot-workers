const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aaa更换api')
        .setDescription('打开 LLM API 设置面板，配置或更换 AI 提供商'),
    commandName: 'aaa更换api',
};
