/**
 * /aaa更换api —— LLM API 设置面板（Workers 版）
 *
 * 与网关版 handler/llm/api_panel_handler.js 的面板样式、按钮、选择菜单、
 * 模态框与文案完全一致；差别只是：discord.js 的 Builder 换成原生 JSON，
 * 配置存储换成 Supabase 版 api_config store（core/api_config_store.js）。
 *
 * 交互约定（由 src/index.js 的路由实现）：
 *   - 直接返回 { type, data } 的是即时响应（更新消息 / 弹模态框）
 *   - 返回 { __deferFlags, __run } 的先 defer 再在 __run 里编辑原始回复
 *   - 返回 { __deferUpdate, __run } 的先 DEFERRED_UPDATE 再编辑面板
 */
import { testConnection } from '../core/llm_caller.js';
import * as api from '../discord_api.js';

const PROVIDER_LABELS = {
    deepseek: 'DeepSeek',
    openai: 'OpenAI',
    qwen: '通义千问 (Qwen)',
    zhipu: '智谱清言 (GLM)',
    custom: '自定义',
};

/** 构建 API 设置面板的 Embed 和组件（原生 JSON） */
export async function buildPanel(ctx) {
    const store = ctx.apiConfig;
    const cfg = await store.getConfig();
    const defaults = store.getDefaults();

    const provider = cfg?.provider || 'deepseek';
    const baseUrl = cfg?.base_url || defaults[provider]?.base_url || '未设置';
    const model = cfg?.model || defaults[provider]?.model || '未设置';
    const apiKeyDisplay = cfg?.api_key ? cfg.api_key.slice(0, 5) + '****' + cfg.api_key.slice(-4) : '未设置';
    const errorCount = cfg?.error_count || 0;
    const isHealthy = errorCount < 3;

    const embed = {
        color: isHealthy ? 0x2ecc71 : 0xe74c3c,
        title: '⚙️ LLM API 设置面板',
        description: '配置 AI 提供商和模型，用于自动打标签等功能',
        fields: [
            { name: '🔌 提供商', value: '**' + (PROVIDER_LABELS[provider] || provider) + '**', inline: true },
            { name: '🌐 API 地址', value: '`' + baseUrl + '`', inline: false },
            { name: '🤖 模型', value: '`' + model + '`', inline: true },
            { name: '🔑 API Key', value: '`' + apiKeyDisplay + '`', inline: true },
            {
                name: '📊 状态',
                value: isHealthy
                    ? '✅ API 可用（' + errorCount + ' 次连续错误）'
                    : '❌ API 已耗尽（' + errorCount + ' 次连续错误，请更新配置）',
                inline: false,
            },
        ],
        footer: { text: '提示：修改配置后自动重置错误计数' },
        timestamp: new Date().toISOString(),
    };

    const components = [
        {
            type: 1,
            components: [
                { type: 2, style: 1, custom_id: 'api_provider', label: '🔁 更换 Provider' },
                { type: 2, style: 2, custom_id: 'api_key', label: '🔑 设置 API Key' },
                { type: 2, style: 2, custom_id: 'api_model', label: '🤖 设置模型' },
            ],
        },
        {
            type: 1,
            components: [
                { type: 2, style: 3, custom_id: 'api_test', label: '🧪 测试连接' },
                { type: 2, style: 4, custom_id: 'api_close', label: '❌ 关闭' },
            ],
        },
    ];

    return { embeds: [embed], components };
}

/** 构建 Provider 选择菜单 */
function buildProviderSelect() {
    const embed = {
        color: 0x3498db,
        title: '🔁 选择 AI 提供商',
        description: '选择一个提供商，API 地址和默认模型将自动填入。\n选择「自定义」后需要手动输入 API 地址。',
        footer: { text: '选择后将跳转回设置面板' },
    };
    const components = [{
        type: 1,
        components: [{
            type: 3,
            custom_id: 'api_select_provider',
            placeholder: '选择 AI 提供商',
            options: [
                { label: 'DeepSeek', value: 'deepseek', description: '默认推荐，性价比高', emoji: { name: '🔵' } },
                { label: 'OpenAI', value: 'openai', description: '需海外网络', emoji: { name: '🟢' } },
                { label: '通义千问 (Qwen)', value: 'qwen', description: '阿里云通义千问', emoji: { name: '🟣' } },
                { label: '智谱清言 (GLM)', value: 'zhipu', description: '智谱 AI', emoji: { name: '🟡' } },
                { label: '自定义', value: 'custom', description: '自定义 OpenAI 兼容接口', emoji: { name: '⚪' } },
            ],
        }],
    }];
    return { embeds: [embed], components };
}

function buildModal(customId, title, inputId, label, placeholder, value) {
    return {
        type: 9,
        data: {
            custom_id: customId,
            title,
            components: [{
                type: 1,
                components: [{
                    type: 4,
                    custom_id: inputId,
                    label,
                    style: 1,
                    placeholder,
                    value: value || undefined,
                    required: true,
                }],
            }],
        },
    };
}

/** 处理 /aaa更换api 命令 */
export async function executeApiPanel(ctx, interaction) {
    return {
        __deferFlags: 64,
        __run: async () => {
            const panel = await buildPanel(ctx);
            await api.editOriginal(ctx.env, interaction, panel);
        },
    };
}

/** 处理按钮 / 选择菜单交互 */
export async function handleApiComponent(ctx, interaction) {
    const customId = interaction.data.custom_id;
    const store = ctx.apiConfig;

    // 关闭：删掉面板消息
    if (customId === 'api_close') {
        return {
            __deferUpdate: true,
            __run: async () => {
                await api.deleteMessage(ctx.env, interaction.channel_id, interaction.message.id).catch(() => {});
            },
        };
    }

    // 显示 Provider 选择菜单
    if (customId === 'api_provider') {
        return { type: 7, data: buildProviderSelect() };
    }

    // 选择 Provider
    if (customId === 'api_select_provider') {
        const provider = interaction.data.values[0];
        if (provider === 'custom') {
            return buildModal('api_modal_custom_url', '设置自定义 API 地址', 'base_url', 'API Base URL', 'https://your-api.com/v1', '');
        }
        await store.setProvider(provider);
        const panel = await buildPanel(ctx);
        return { type: 7, data: panel };
    }

    // 设置 API Key
    if (customId === 'api_key') {
        const cfg = await store.getConfig();
        return buildModal('api_modal_key', '设置 API Key', 'api_key', 'API Key', 'sk-...', cfg?.api_key || '');
    }

    // 设置模型
    if (customId === 'api_model') {
        const cfg = await store.getConfig();
        return buildModal('api_modal_model', '设置模型名称', 'model', '模型名称', 'gpt-4o-mini, deepseek-chat, qwen-plus...', cfg?.model || '');
    }

    // 测试连接
    if (customId === 'api_test') {
        return {
            __deferFlags: 64,
            __run: async () => {
                const result = await testConnection(store);
                await api.editOriginal(ctx.env, interaction, { content: result.msg });
                const panel = await buildPanel(ctx);
                if (interaction.message) {
                    await api.editMessage(ctx.env, interaction.channel_id, interaction.message.id, panel).catch(() => {});
                }
            },
        };
    }

    return null;
}

/** 处理模态框提交 */
export async function handleApiModal(ctx, interaction) {
    const customId = interaction.data.custom_id;
    const store = ctx.apiConfig;
    const fieldValue = (id) => {
        for (const row of interaction.data.components || []) {
            for (const c of row.components || []) {
                if (c.custom_id === id) return c.value;
            }
        }
        return '';
    };

    let handled = true;
    if (customId === 'api_modal_key') {
        await store.setApiKey(fieldValue('api_key'));
    } else if (customId === 'api_modal_model') {
        await store.setModel(fieldValue('model'));
    } else if (customId === 'api_modal_custom_url') {
        await store.setCustomBaseUrl(fieldValue('base_url'));
    } else {
        handled = false;
    }
    if (!handled) return null;

    return {
        __deferUpdate: true,
        __run: async () => {
            const panel = await buildPanel(ctx);
            await api.editOriginal(ctx.env, interaction, panel);
        },
    };
}
