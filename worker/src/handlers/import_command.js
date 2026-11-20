/**
 * /aaa导入 —— 自动导入的命令版入口（Workers 版新增）
 *
 * 网关版靠监听频道实现零点击导入；Workers 没有消息事件，改为在命令里
 * 附带文件（可多附几个），后续流水线与监听版完全共用（pipeline.js）：
 * 识别 → 查重 → 分论坛发帖 → 自动打标签 → 图床备份。
 */
import { processImportedFile } from '../pipeline.js';
import { editOriginal } from '../discord_api.js';

export const IMPORT_OPTION_NAMES = ['file', 'file2', 'file3', 'file4', 'file5'];

const STATUS_LABELS = {
    success: '✅ 导入成功',
    appended: '✅ 已追加到已有帖子',
    duplicate: '🔁 重复文件，已跳过',
    failed: '❌ 导入失败（详情见日志频道）',
    unsupported: '❓ 无法识别的文件格式',
};

export async function executeImportCommand(ctx, interaction) {
    const options = interaction.data.options || [];
    const resolved = interaction.data.resolved?.attachments || {};

    const attachments = [];
    for (const name of IMPORT_OPTION_NAMES) {
        const opt = options.find(o => o.name === name);
        if (!opt) continue;
        const att = resolved[opt.value];
        if (att) attachments.push(att);
    }

    return {
        __deferFlags: 0,
        __run: async () => {
            if (attachments.length === 0) {
                await editOriginal(ctx.env, interaction, { content: '❌ 没有收到文件，请在命令里附带文件再试。' });
                return;
            }

            const lines = [];
            for (const att of attachments) {
                try {
                    const response = await fetch(att.url);
                    if (!response.ok) throw new Error('附件下载失败 HTTP ' + response.status);
                    const buffer = Buffer.from(await response.arrayBuffer());
                    const status = await processImportedFile(ctx, { name: att.filename, url: att.url, buffer });
                    lines.push(`${STATUS_LABELS[status] || status}：${att.filename}`);
                } catch (e) {
                    console.error('[aaa导入] 处理失败:', att.filename, e.message);
                    lines.push(`❌ 导入失败（详情见日志频道）：${att.filename}`);
                }
            }

            await editOriginal(ctx.env, interaction, { content: lines.join('\n') });
        },
    };
}
