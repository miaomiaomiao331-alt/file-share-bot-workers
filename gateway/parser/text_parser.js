/**
 * TXT 文本文档解析器
 *
 * 从常见的中文文本文档格式中提取元信息：
 *   - 标题：正文中的《书名》，其次文件名
 *   - 作者：正文中的「作者：xxx」，其次文件名中的「作者_xxx」
 *   - 简介：「文案：」段落（截取到分隔线或章节开始）
 *   - 标签：「内容标签：」行
 *
 * 编码：自动识别 UTF-8 / GB18030（覆盖 GBK/GB2312）
 */

const Asset = require('./asset');

/**
 * 解码文本：优先 UTF-8，乱码率过高时回退 GB18030
 */
function decodeText(buffer) {
    const utf8 = buffer.toString('utf-8');
    // U+FFFD 是解码失败的替换符，比例过高说明不是 UTF-8
    const badCount = (utf8.match(/\uFFFD/g) || []).length;
    if (badCount / Math.max(utf8.length, 1) < 0.01) {
        return utf8;
    }
    try {
        return new TextDecoder('gb18030').decode(buffer);
    } catch {
        return utf8;
    }
}

/** 清理行：去掉全角/半角空白和 BOM */
function cleanLine(line) {
    return line.replace(/^[\s\u3000\uFEFF]+|[\s\u3000]+$/g, '');
}

/**
 * 从文件名提取标题/作者（回退用）
 * 例：_顶级追妻火葬场_快穿__作者_低头找月亮.txt
 */
function parseFilename(filename) {
    const stem = filename.replace(/\.[^/.]+$/, '');
    let author = '';
    let title = stem;

    const m = stem.match(/作者[_：:\s]*(.+)$/);
    if (m) {
        author = m[1].replace(/[_\s]+/g, ' ').trim();
        title = stem.slice(0, m.index).replace(/[_\s]+$/g, '');
    }
    title = title.replace(/^[_\s]+|[_\s]+$/g, '').replace(/_+/g, ' ').trim() || stem;
    return { title, author };
}

/**
 * 解析 TXT → Asset
 * @param {{name:string,url:string,buffer:Buffer,hash:string}} file
 */
function parseText(file) {
    const text = decodeText(file.buffer);
    const head = text.slice(0, 6000);
    const lines = head.split(/\r?\n/).map(cleanLine);

    const fromFilename = parseFilename(file.name);
    let title = '';
    let author = '';
    let intro = '';
    let tags = [];

    // 标题：《xxx》
    const titleMatch = head.match(/《([^《》\n]{1,60})》/);
    if (titleMatch) title = titleMatch[1].trim();

    // 作者：作者：xxx
    const authorMatch = head.match(/作者[：:]\s*([^\s\r\n《》]{1,30})/);
    if (authorMatch) author = authorMatch[1].trim();

    // 内容标签：xxx xxx
    const tagMatch = head.match(/内容标签[：:]\s*([^\r\n]+)/);
    if (tagMatch) {
        tags = tagMatch[1].split(/[\s、,，]+/).map(t => t.trim()).filter(Boolean).slice(0, 15);
    }

    // 文案段落：从「文案：」行开始，到分隔线/章节/元信息行为止
    const introStart = lines.findIndex(l => /^文案[：:]?$/.test(l) || /^文案[：:]/.test(l));
    if (introStart !== -1) {
        const collected = [];
        // 「文案：」同行可能就带内容
        const firstLine = lines[introStart].replace(/^文案[：:]\s*/, '');
        if (firstLine) collected.push(firstLine);

        for (let i = introStart + 1; i < lines.length; i++) {
            const l = lines[i];
            if (/^[=—－\-*＊]{3,}$/.test(l)) break;
            if (/^(内容标签|搜索关键字|一句话简介|立意|作品简评|正文|第[一二三四五六七八九十百千0-9]+[章节卷])/.test(l)) break;
            collected.push(l);
        }
        intro = collected.join('\n').trim();
    }

    const finalTitle = title || fromFilename.title;
    const finalAuthor = author || fromFilename.author;

    // 字数统计（去除空白后的字符数）
    const charCount = text.replace(/\s/g, '').length;

    const parts = [`字数：约 ${charCount.toLocaleString('zh-CN')} 字`];
    if (intro) parts.push(intro);

    return new Asset({
        type: 'text',
        name: finalTitle,
        description: parts.join('\n\n'),
        creator: finalAuthor,
        tags,
        cover: null,
        attachments: [{ filename: file.name, url: file.url, hash: file.hash }],
        source: { filename: file.name },
        metadata: { charCount },
    });
}

module.exports = { parseText };
