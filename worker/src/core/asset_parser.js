/**
 * 统一素材解析入口
 *
 * 类型识别完全基于文件结构（PNG 数据块 / JSON 字段），不需要 LLM：
 *   - PNG                → 一律按角色卡解析（角色卡是唯一的 PNG 嵌入格式）
 *   - JSON + 角色卡特征   → character（spec 为 chara_card* / data.name / name+first_mes 等）
 *   - JSON + entries 特征 → worldbook
 *   - JSON + 预设特征     → preset
 *   - 其他               → null（不支持的文件）
 *
 * 返回值：{ asset, type } 或 { asset: null, type: 'unknown' | 'unsupported' }
 */

import { parseCharacter } from './character_parser.js';
import { isWorldbook, parseWorldbook } from './worldbook_parser.js';
import { isPreset, parsePreset } from './preset_parser.js';
import { parseText } from './text_parser.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * 判断 JSON 对象是否为角色卡
 */
function isCharacterCard(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (typeof obj.spec === 'string' && obj.spec.startsWith('chara_card')) return true;
    if (obj.data && typeof obj.data === 'object' && typeof obj.data.name === 'string') return true;
    // V1 卡：顶层 name + 角色卡典型字段
    if (typeof obj.name === 'string' && (
        obj.first_mes !== undefined
        || obj.personality !== undefined
        || obj.mes_example !== undefined
        || obj.scenario !== undefined
    )) return true;
    return false;
}

/**
 * 解析任意上传文件
 * @param {{name:string,url:string,buffer:Buffer,hash:string}} file
 * @returns {Promise<{asset: object|null, type: string}>}
 */
async function parseAsset(file) {
    const lowerName = (file.name || '').toLowerCase();
    const buffer = file.buffer;

    if (!buffer || buffer.length < 4) {
        return { asset: null, type: 'unsupported' };
    }

    // ---- PNG：角色卡 ----
    if (buffer.length >= 8 && buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
        const asset = await parseCharacter(file);
        // PNG 里没读到卡数据（name 会回退为文件名且无描述）视为解析失败由调用方判断
        const hasCardData = !!(asset.metadata
            && asset.metadata.characterData
            && Object.keys(asset.metadata.characterData).length > 0);
        return { asset, type: hasCardData ? 'character' : 'unknown' };
    }

    // ---- JSON：按结构分流 ----
    if (lowerName.endsWith('.json')) {
        let obj = null;
        try {
            obj = JSON.parse(buffer.toString('utf-8'));
        } catch {
            return { asset: null, type: 'unknown' };
        }
        if (!obj || typeof obj !== 'object') {
            return { asset: null, type: 'unknown' };
        }

        // 顺序很重要：角色卡可能内嵌 character_book，需先判角色卡
        if (isCharacterCard(obj)) {
            const asset = await parseCharacter(file);
            return { asset, type: 'character' };
        }
        if (isWorldbook(obj)) {
            return { asset: parseWorldbook(file, obj), type: 'worldbook' };
        }
        if (isPreset(obj)) {
            return { asset: parsePreset(file, obj), type: 'preset' };
        }
        return { asset: null, type: 'unknown' };
    }

    // ---- TXT：文本文档 ----
    if (lowerName.endsWith('.txt')) {
        return { asset: parseText(file), type: 'text' };
    }

    return { asset: null, type: 'unsupported' };
}

/** 类型的中文显示名 */
const TYPE_LABELS = {
    character: '角色卡',
    worldbook: '世界书',
    preset: '预设',
    text: '文本',
};

export { parseAsset, isCharacterCard, TYPE_LABELS };
