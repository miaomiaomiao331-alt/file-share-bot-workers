/**
 * /aaa素材搜索 与 /aaa角色搜索（Workers 版）
 *
 * 与网关版 handler/archive/search_handler.js、charsearch_handler.js
 * 逻辑与文案一致；差别：数据改查 Supabase 版 archive_store（与自动导入
 * 共用一本账，搜卡查不到导入卡的问题随之消失），Embed/按钮改为原生
 * JSON，翻页按钮走 UPDATE_MESSAGE 直接更新。
 */

import { editOriginal } from '../discord_api.js';

const PAGE_SIZE = 8;

function parseTags(tagsStr) {
    return String(tagsStr || '').split(/\s+/).filter(t => t.trim().length > 0);
}

function pageButtons(prefix, key, result) {
    if (result.totalPages <= 1) return [];
    const row = { type: 1, components: [] };
    if (result.page > 1) {
        row.components.push({
            type: 2, style: 1,
            custom_id: `${prefix}:${key}:${result.page - 1}`,
            label: '◀ 上一页',
        });
    }
    if (result.page < result.totalPages) {
        row.components.push({
            type: 2, style: 1,
            custom_id: `${prefix}:${key}:${result.page + 1}`,
            label: '下一页 ▶',
        });
    }
    return row.components.length > 0 ? [row] : [];
}

/** 构建素材搜索结果 payload（命令与翻页共用） */
export async function buildTagSearchPayload(ctx, tagsStr, page) {
    const tagList = parseTags(tagsStr);
    if (tagList.length === 0) return { content: '❌ 请至少输入一个搜索标签。' };

    const result = await ctx.archive.searchByTags(tagList, page, PAGE_SIZE);
    if (result.files.length === 0) {
        return { content: `😅 没有找到包含标签 \`${tagList.join('`, `')}\` 的素材。` };
    }

    const embed = {
        color: 0x3498db,
        title: '🔍 素材搜索结果',
        description: `搜索标签: \`${tagList.join('`, `')}\`\n共找到 **${result.total}** 个素材 | 第 ${result.page}/${result.totalPages} 页`,
        timestamp: new Date().toISOString(),
        fields: [],
    };

    for (const file of result.files) {
        let fileTags;
        try { fileTags = JSON.parse(file.tags); } catch { fileTags = []; }
        const tagDisplay = fileTags.map(t => `\`${t}\``).join(' ');
        const typeIcon = file.file_type === 'character_card' ? '🎭' : '📄';
        embed.fields.push({
            name: `${typeIcon} ${file.file_name}`,
            value: [
                `🏷️ ${tagDisplay || '无标签'}`,
                `📦 ${(file.file_size / 1024).toFixed(1)} KB`,
                `👤 <@${file.uploader_id}> | <t:${Math.floor(new Date(file.upload_time).getTime() / 1000)}:R>`,
            ].join('\n'),
            inline: false,
        });
    }

    return { embeds: [embed], components: pageButtons('archive_search_page', tagsStr, result) };
}

/** 构建角色搜索结果 payload（命令与翻页共用） */
export async function buildCharSearchPayload(ctx, nameQuery, page) {
    if (!nameQuery || nameQuery.trim().length === 0) return { content: '❌ 请输入要搜索的角色名。' };

    const result = await ctx.archive.searchCharacterCards(nameQuery.trim(), page, PAGE_SIZE);
    if (result.cards.length === 0) {
        return { content: `😅 没有找到角色名包含「${nameQuery}」的角色卡。` };
    }

    const embed = {
        color: 0x9b59b6,
        title: '🎭 角色卡搜索结果',
        description: `搜索角色名: **${nameQuery}**\n共找到 **${result.total}** 张角色卡 | 第 ${result.page}/${result.totalPages} 页`,
        timestamp: new Date().toISOString(),
        fields: [],
    };

    for (const card of result.cards) {
        let fileTags;
        try { fileTags = JSON.parse(card.tags); } catch { fileTags = []; }
        const tagDisplay = fileTags.map(t => `\`${t}\``).join(' ');
        embed.fields.push({
            name: `🎭 ${card.character_name}`,
            value: [
                `📁 ${card.file_name}`,
                `🏷️ ${tagDisplay || '无标签'}`,
                `📦 ${(card.file_size / 1024).toFixed(1)} KB`,
                `👤 <@${card.uploader_id}> | <t:${Math.floor(new Date(card.upload_time).getTime() / 1000)}:R>`,
            ].join('\n'),
            inline: false,
        });
    }

    return { embeds: [embed], components: pageButtons('archive_char_page', nameQuery, result) };
}

function getOption(interaction, name) {
    return (interaction.data.options || []).find(o => o.name === name)?.value;
}

export async function executeTagSearch(ctx, interaction) {
    const tagsStr = getOption(interaction, 'tags') || '';
    const page = getOption(interaction, 'page') || 1;
    return {
        __deferFlags: 64,
        __run: async () => {
            try {
                const payload = await buildTagSearchPayload(ctx, tagsStr, page);
                await editOriginal(ctx.env, interaction, payload);
            } catch (error) {
                console.error('[search] 搜索素材出错:', error);
                await editOriginal(ctx.env, interaction, { content: '❌ 搜索时发生错误: ' + error.message });
            }
        },
    };
}

export async function executeCharSearch(ctx, interaction) {
    const nameQuery = getOption(interaction, 'name') || '';
    const page = getOption(interaction, 'page') || 1;
    return {
        __deferFlags: 64,
        __run: async () => {
            try {
                const payload = await buildCharSearchPayload(ctx, nameQuery, page);
                await editOriginal(ctx.env, interaction, payload);
            } catch (error) {
                console.error('[charsearch] 搜索角色卡出错:', error);
                await editOriginal(ctx.env, interaction, { content: '❌ 搜索时发生错误: ' + error.message });
            }
        },
    };
}

/** 翻页按钮：custom_id = archive_search_page:<tags>:<page> / archive_char_page:<name>:<page> */
export async function handleSearchPageButton(ctx, interaction) {
    const customId = interaction.data.custom_id;
    const isChar = customId.startsWith('archive_char_page:');
    const rest = customId.slice(isChar ? 'archive_char_page:'.length : 'archive_search_page:'.length);
    const sep = rest.lastIndexOf(':');
    const key = rest.slice(0, sep);
    const page = parseInt(rest.slice(sep + 1), 10) || 1;

    const payload = isChar
        ? await buildCharSearchPayload(ctx, key, page)
        : await buildTagSearchPayload(ctx, key, page);

    return {
        type: 7, // UPDATE_MESSAGE
        data: { ...payload, flags: 64 },
    };
}
