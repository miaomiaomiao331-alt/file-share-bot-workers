const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getApiConfigDb } = require('../../db/api_config_db');
const { testConnection } = require('../../utils/llm_caller');

const configDb = getApiConfigDb();
const PROVIDER_LABELS = {
    deepseek: 'DeepSeek',
    openai: 'OpenAI',
    qwen: '通义千问 (Qwen)',
    zhipu: '智谱清言 (GLM)',
    custom: '自定义',
};

/**
 * 构建 API 设置面板的 Embed 和组件
 */
async function buildPanel() {
    const cfg = await configDb.getConfig();
    const defaults = configDb.getDefaults();

    const provider = cfg?.provider || 'deepseek';
    const baseUrl = cfg?.base_url || defaults[provider]?.base_url || '未设置';
    const model = cfg?.model || defaults[provider]?.model || '未设置';
    const apiKeyDisplay = cfg?.api_key ? cfg.api_key.slice(0, 5) + '****' + cfg.api_key.slice(-4) : '未设置';
    const errorCount = cfg?.error_count || 0;
    const isHealthy = errorCount < 3;

    const embed = new EmbedBuilder()
        .setColor(isHealthy ? 0x2ecc71 : 0xe74c3c)
        .setTitle('⚙️ LLM API 设置面板')
        .setDescription('配置 AI 提供商和模型，用于自动打标签等功能')
        .addFields(
            { name: '🔌 提供商', value: '**' + (PROVIDER_LABELS[provider] || provider) + '**', inline: true },
            { name: '🌐 API 地址', value: '`' + baseUrl + '`', inline: false },
            { name: '🤖 模型', value: '`' + model + '`', inline: true },
            { name: '🔑 API Key', value: '`' + apiKeyDisplay + '`', inline: true },
            { name: '📊 状态', value: isHealthy
                ? '✅ API 可用（' + errorCount + ' 次连续错误）'
                : '❌ API 已耗尽（' + errorCount + ' 次连续错误，请更新配置）',
            inline: false }
        )
        .setFooter({ text: '提示：修改配置后自动重置错误计数' })
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('api_provider').setLabel('🔁 更换 Provider').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('api_key').setLabel('🔑 设置 API Key').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('api_model').setLabel('🤖 设置模型').setStyle(ButtonStyle.Secondary),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('api_test').setLabel('🧪 测试连接').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('api_close').setLabel('❌ 关闭').setStyle(ButtonStyle.Danger),
    );

    return { embeds: [embed], components: [row1, row2] };
}

/**
 * 构建 Provider 选择菜单
 */
function buildProviderSelect() {
    const select = new StringSelectMenuBuilder()
        .setCustomId('api_select_provider')
        .setPlaceholder('选择 AI 提供商')
        .addOptions(
            { label: 'DeepSeek', value: 'deepseek', description: '默认推荐，性价比高', emoji: '🔵' },
            { label: 'OpenAI', value: 'openai', description: '需海外网络', emoji: '🟢' },
            { label: '通义千问 (Qwen)', value: 'qwen', description: '阿里云通义千问', emoji: '🟣' },
            { label: '智谱清言 (GLM)', value: 'zhipu', description: '智谱 AI', emoji: '🟡' },
            { label: '自定义', value: 'custom', description: '自定义 OpenAI 兼容接口', emoji: '⚪' },
        );

    const row = new ActionRowBuilder().addComponents(select);
    const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🔁 选择 AI 提供商')
        .setDescription('选择一个提供商，API 地址和默认模型将自动填入。\n选择「自定义」后需要手动输入 API 地址。')
        .setFooter({ text: '选择后将跳转回设置面板' });

    return { embeds: [embed], components: [row], ephemeral: true };
}

/**
 * 处理 /aaa更换api 命令
 */
async function executeCommand(interaction) {
    await interaction.deferReply({ flags: [64] });
    const panel = await buildPanel();
    await interaction.editReply(panel);
}

/**
 * 处理按钮 / 选择菜单交互
 */
async function handleInteraction(interaction) {
    const customId = interaction.customId;

    // 关闭
    if (customId === 'api_close') {
        await interaction.message.delete().catch(() => {});
        return true;
    }

    // 显示 Provider 选择菜单
    if (customId === 'api_provider') {
        const selectPanel = buildProviderSelect();
        await interaction.update(selectPanel);
        return true;
    }

    // 选择 Provider
    if (customId === 'api_select_provider') {
        const provider = interaction.values[0];
        if (provider === 'custom') {
            // 自定义：弹窗让用户输入 base_url
            const modal = new ModalBuilder()
                .setCustomId('api_modal_custom_url')
                .setTitle('设置自定义 API 地址')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('base_url')
                            .setLabel('API Base URL')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('https://your-api.com/v1')
                            .setRequired(true)
                    )
                );
            await interaction.showModal(modal);
        } else {
            await configDb.setProvider(provider);
            const panel = await buildPanel();
            await interaction.update(panel);
        }
        return true;
    }

    // 设置 API Key
    if (customId === 'api_key') {
        const cfg = await configDb.getConfig();
        const modal = new ModalBuilder()
            .setCustomId('api_modal_key')
            .setTitle('设置 API Key')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('api_key')
                        .setLabel('API Key')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('sk-...')
                        .setValue(cfg?.api_key || '')
                        .setRequired(true)
                )
            );
        await interaction.showModal(modal);
        return true;
    }

    // 设置模型
    if (customId === 'api_model') {
        const cfg = await configDb.getConfig();
        const modal = new ModalBuilder()
            .setCustomId('api_modal_model')
            .setTitle('设置模型名称')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('model')
                        .setLabel('模型名称')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('gpt-4o-mini, deepseek-chat, qwen-plus...')
                        .setValue(cfg?.model || '')
                        .setRequired(true)
                )
            );
        await interaction.showModal(modal);
        return true;
    }

    // 测试连接
    if (customId === 'api_test') {
        await interaction.deferReply({ flags: [64] });
        const result = await testConnection();
        await interaction.editReply({ content: result.msg });

        // 更新面板
        const panel = await buildPanel();
        if (interaction.message) {
            await interaction.message.edit(panel).catch(() => {});
        }
        return true;
    }

    return false;
}

/**
 * 处理模态框提交
 */
async function handleModal(interaction) {
    const customId = interaction.customId;

    // API Key 模态框
    if (customId === 'api_modal_key') {
        const apiKey = interaction.fields.getTextInputValue('api_key');
        await configDb.setApiKey(apiKey);
        await interaction.deferUpdate();
        const panel = await buildPanel();
        await interaction.editReply(panel);
        return true;
    }

    // 模型名称模态框
    if (customId === 'api_modal_model') {
        const model = interaction.fields.getTextInputValue('model');
        await configDb.setModel(model);
        await interaction.deferUpdate();
        const panel = await buildPanel();
        await interaction.editReply(panel);
        return true;
    }

    // 自定义 URL 模态框
    if (customId === 'api_modal_custom_url') {
        const baseUrl = interaction.fields.getTextInputValue('base_url');
        await configDb.setCustomBaseUrl(baseUrl);
        await interaction.deferUpdate();
        const panel = await buildPanel();
        await interaction.editReply(panel);
        return true;
    }

    return false;
}

module.exports = {
    commandName: 'aaa更换api',
    requiredPermission: 0,
    execute: executeCommand,
    handleInteraction: handleInteraction,
    handleModal: handleModal,
};
