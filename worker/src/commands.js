/**
 * 斜杠命令定义（注册用，见 scripts/register_commands.mjs）
 *
 * 与网关版 command/ 目录一一对应，另加 Workers 版新增的 /aaa导入。
 * 选项类型：3=STRING 4=INTEGER 11=ATTACHMENT
 */
export const COMMANDS = [
    {
        name: 'aaa导入',
        description: '把文件导入归档系统（自动识别角色卡/世界书/预设/文本并发到对应论坛）',
        options: [
            { type: 11, name: 'file', description: '要导入的文件', required: true },
            { type: 11, name: 'file2', description: '追加文件 2（可选）', required: false },
            { type: 11, name: 'file3', description: '追加文件 3（可选）', required: false },
            { type: 11, name: 'file4', description: '追加文件 4（可选）', required: false },
            { type: 11, name: 'file5', description: '追加文件 5（可选）', required: false },
        ],
    },
    {
        name: 'aaa素材上传',
        description: '上传素材文件到归档系统，支持自动识别 SillyTavern 角色卡',
        options: [
            { type: 11, name: 'file', description: '要上传的素材文件', required: true },
            { type: 3, name: 'tags', description: '标签（用空格分隔，例如: Novel BL Completed）', required: true, autocomplete: true },
        ],
    },
    {
        name: 'aaa素材搜索',
        description: '按标签组合搜索已归档的素材',
        options: [
            { type: 3, name: 'tags', description: '搜索标签（用空格分隔，例如: Novel BL）', required: true, autocomplete: true },
            { type: 4, name: 'page', description: '页码', required: false, min_value: 1 },
        ],
    },
    {
        name: 'aaa角色搜索',
        description: '按角色名搜索 SillyTavern 角色卡',
        options: [
            { type: 3, name: 'name', description: '角色名（支持模糊搜索）', required: true },
            { type: 4, name: 'page', description: '页码', required: false, min_value: 1 },
        ],
    },
    {
        name: 'aaa更换api',
        description: '打开 LLM API 设置面板，配置或更换 AI 提供商',
        options: [],
    },
];
