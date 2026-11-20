/**
 * CloudFlare-ImgBed 自动备份（可选功能）
 *
 * 在 .env 中配置后启用；不配置则整个功能静默跳过，不影响任何流程：
 *   IMGBED_URL=https://your-imgbed.example.com   # ImgBed 部署地址
 *   IMGBED_AUTH_CODE=xxxx                        # 上传鉴权码（未开鉴权可留空）
 *
 * 导入成功后，文件会额外 POST 到 ImgBed 的 /upload 接口作为异地备份，
 * 返回的外链会记录进本地 Asset 缓存与日志频道。
 * 备份失败只记日志，绝不影响导入主流程。
 */

function isImgBedEnabled() {
    return !!process.env.IMGBED_URL;
}

/**
 * 上传单个文件到 ImgBed
 * @param {{name:string, buffer:Buffer}} file
 * @returns {Promise<string|null>} 备份外链，失败返回 null
 */
async function backupToImgBed(file) {
    if (!isImgBedEnabled()) return null;

    const base = process.env.IMGBED_URL.replace(/\/+$/, '');
    const auth = process.env.IMGBED_AUTH_CODE;

    const url = base + '/upload'
        + (auth ? `?authCode=${encodeURIComponent(auth)}` : '');

    try {
        const form = new FormData();
        form.append('file', new Blob([file.buffer]), file.name);

        const res = await fetch(url, {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(60000),
        });

        if (!res.ok) {
            console.error('[ImgBed] 备份失败 HTTP', res.status, file.name);
            return null;
        }

        // ImgBed 返回格式: [{ "src": "/file/xxxx" }]
        const data = await res.json();
        const src = Array.isArray(data) ? data[0]?.src : data?.src;
        if (!src) {
            console.error('[ImgBed] 响应中没有 src 字段:', file.name);
            return null;
        }

        const backupUrl = src.startsWith('http') ? src : base + src;
        console.log('[ImgBed] 备份成功:', file.name, '→', backupUrl);
        return backupUrl;

    } catch (e) {
        console.error('[ImgBed] 备份出错:', file.name, e.message);
        return null;
    }
}

module.exports = { isImgBedEnabled, backupToImgBed };
