/**
 * SillyTavern 角色卡解析器
 *
 * 支持两种格式:
 *   1. PNG 格式 — 数据嵌入在 tEXt 块中，关键字 "chara" / "data" / "ccv3"
 *      值可以是纯 JSON 或 base64 编码的 JSON
 *   2. JSON 格式 — 直接是 .json 文件，内容是角色卡 JSON
 *
 * PNG 块结构: [4字节 长度][4字节 类型][长度字节 数据][4字节 CRC]
 * tEXt 数据格式: [关键字]\0[文本]
 */

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * 从 buffer 中提取角色卡数据
 * @param {Buffer} buffer - 文件二进制数据
 * @param {string} [fileName] - 文件名，用于判断是 JSON 还是 PNG
 * @returns {{ name: string|null, data: object|null }}
 */
function extractCharacterData(buffer, fileName) {
    if (!buffer || buffer.length < 8) return { name: null, data: null };

    const lowerName = (fileName || '').toLowerCase();

    // JSON 格式 (.json 文件)
    if (lowerName.endsWith('.json')) {
        return extractFromJsonBuffer(buffer);
    }

    // PNG 格式
    if (buffer.slice(0, 8).equals(PNG_SIGNATURE) && buffer.length >= 24) {
        return extractFromPngBuffer(buffer);
    }

    return { name: null, data: null };
}

/**
 * 从 JSON buffer 中提取角色卡数据
 */
function extractFromJsonBuffer(buffer) {
    try {
        const text = buffer.toString('utf-8');
        const obj = JSON.parse(text);
        if (obj && typeof obj === 'object') {
            const name = extractName(obj);
            return { name, data: obj };
        }
    } catch {}
    return { name: null, data: null };
}

/**
 * 从 PNG buffer 的 tEXt/iTXt 块中提取角色卡数据
 */
function extractFromPngBuffer(buffer) {
    let offset = 8;

    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);

        if (offset + 12 + length > buffer.length) break;

        const data = buffer.slice(offset + 8, offset + 8 + length);

        if (type === 'tEXt' || type === 'iTXt') {
            const nullIndex = data.indexOf(0);
            if (nullIndex > 0) {
                const keyword = data.toString('ascii', 0, nullIndex);

                if (['chara', 'data', 'ccv3'].includes(keyword)) {
                    const text = data.toString('utf-8', nullIndex + 1);
                    const parsed = tryParseJson(text);
                    if (parsed) {
                        const name = extractName(parsed);
                        return { name, data: parsed };
                    }
                }
            }
        }

        offset += 12 + length;
        if (offset > buffer.length) break;
    }

    return { name: null, data: null };
}

/**
 * 尝试从原始文本中解析 JSON
 * 处理纯 JSON、base64 编码的 JSON
 */
function tryParseJson(text) {
    if (!text) return null;
    const str = text.trim();

    // 直接解析
    try {
        const obj = JSON.parse(str);
        if (obj && typeof obj === 'object') return obj;
    } catch {}

    // 尝试 base64 解码后解析
    try {
        const decoded = Buffer.from(str, 'base64').toString('utf-8');
        const obj = JSON.parse(decoded);
        if (obj && typeof obj === 'object') return obj;
    } catch {}

    return null;
}

/**
 * 从角色卡 JSON 中提取角色名
 * V2 格式: { spec: "chara_card_v2", data: { name: "..." } }
 * V1 格式: { name: "..." }
 */
function extractName(obj) {
    if (!obj) return null;

    if (obj.data && typeof obj.data.name === 'string') {
        return obj.data.name.trim();
    }

    if (typeof obj.name === 'string') {
        return obj.name.trim();
    }

    if (obj.spec && typeof obj.spec === 'string') return obj.spec.trim();

    return null;
}

export { extractCharacterData };
