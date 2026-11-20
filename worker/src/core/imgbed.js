/**
 * CloudFlare-ImgBed 自动备份（可选功能，Workers 版）
 *
 * 与网关版 utils/imgbed_backup.js 逻辑一致：配置了 IMGBED_URL 才启用；
 * 导入成功后把文件额外 POST 到 ImgBed 的 /upload 作异地备份，
 * 失败只记日志，绝不影响导入主流程。
 */

export function isImgBedEnabled(env) {
    return !!env.IMGBED_URL;
}

/**
 * 上传单个文件到 ImgBed
 * @param {{name:string, buffer:Buffer}} file
 * @returns {Promise<string|null>} 备份外链，失败返回 null
 */
export async function backupToImgBed(env, file) {
    if (!isImgBedEnabled(env)) return null;

    const base = env.IMGBED_URL.replace(/\/+$/, '');
    const auth = env.IMGBED_AUTH_CODE;

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

        const data = await res.json();
        const src = Array.isArray(data) ? data[0]?.src : data?.src;
        if (!src) {
            console.error('[ImgBed] 响应中没有 src 字段:', file.name);
            return null;
        }

        return src.startsWith('http') ? src : base + src;

    } catch (e) {
        console.error('[ImgBed] 备份出错:', file.name, e.message);
        return null;
    }
}
