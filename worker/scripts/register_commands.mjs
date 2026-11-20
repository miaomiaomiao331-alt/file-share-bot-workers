/**
 * 注册斜杠命令到指定服务器（原版靠网关登录后注册；Workers 版用 REST 一次性注册）
 *
 * 用法：
 *   DISCORD_TOKEN=xxx DISCORD_APPLICATION_ID=xxx GUILD_ID=xxx npm run register
 * 三个值也可以写在 worker/.dev.vars 或直接 export 到环境。
 */
import { COMMANDS } from '../src/commands.js';

const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.GUILD_ID;

if (!token || !appId || !guildId) {
    console.error('缺少环境变量：DISCORD_TOKEN / DISCORD_APPLICATION_ID / GUILD_ID');
    process.exit(1);
}

const url = `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`;
const res = await fetch(url, {
    method: 'PUT',
    headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bot ' + token,
    },
    body: JSON.stringify(COMMANDS),
});

if (!res.ok) {
    console.error('注册失败 HTTP', res.status, await res.text());
    process.exit(1);
}

const data = await res.json();
console.log(`已注册 ${data.length} 个命令：`, data.map(c => c.name).join('、'));
