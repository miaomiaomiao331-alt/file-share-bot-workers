/**
 * LLM API 调用模块（Workers 版）
 * 支持 OpenAI 兼容接口：DeepSeek、OpenAI、通义千问、智谱清言、自定义
 *
 * 与网关版 utils/llm_caller.js 逻辑一致，只是配置存储改为传入的
 * Supabase 版 api_config store（见 core/api_config_store.js）。
 */

export const ERROR_THRESHOLD = 3; // 连续错误次数达到此值则标记为额度用尽

/**
 * 调用 LLM 获取补全结果
 * @param {object} store - createApiConfigStore() 的返回值
 * @param {Array} messages - 消息列表 [{ role, content }]
 * @param {object} [options] - 可选参数 { temperature, max_tokens }
 * @returns {Promise<{ success: boolean, content?: string, error?: string, exhausted?: boolean }>}
 */
export async function callLLM(store, messages, options = {}) {
    const config = await store.getConfig();

    if (!config || !config.api_key) {
        return { success: false, error: 'API Key 未设置，请使用 /aaa更换api 配置' };
    }

    // 检查是否已耗尽
    if (config.error_count >= ERROR_THRESHOLD) {
        return {
            success: false,
            error: 'API 已耗尽（连续 ' + config.error_count + ' 次错误），请检查 API Key 或更换 Provider',
            exhausted: true,
        };
    }

    const apiUrl = (config.base_url || 'https://api.deepseek.com/v1').replace(/\/+$/, '') + '/chat/completions';

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + config.api_key,
            },
            body: JSON.stringify({
                model: config.model || 'deepseek-chat',
                messages: messages,
                temperature: options.temperature ?? 0.3,
                max_tokens: options.max_tokens ?? 1024,
            }),
            signal: AbortSignal.timeout(120000), // 120 秒超时（GLM 推理较慢）
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            let errorMsg = 'HTTP ' + response.status;
            if (response.status === 401) errorMsg = 'API Key 无效（401），请检查密钥';
            else if (response.status === 402) errorMsg = 'API 余额不足（402），请充值';
            else if (response.status === 429) errorMsg = 'API 请求过于频繁（429），请稍后重试';
            else if (body) errorMsg += ': ' + body.slice(0, 200);

            await store.incrementError(errorMsg);

            const newConfig = await store.getConfig();
            const exhausted = newConfig && newConfig.error_count >= ERROR_THRESHOLD;

            return { success: false, error: errorMsg, exhausted };
        }

        const data = await response.json();

        // 重置错误计数
        await store.resetErrors();

        let content = '';
        if (data.choices && data.choices.length > 0) {
            content = data.choices[0].message?.content || '';
        } else if (data.content) {
            content = data.content;
        }

        return { success: true, content };

    } catch (err) {
        let errorMsg = err.name === 'AbortError' ? 'API 请求超时（120秒）' : 'API 调用失败: ' + err.message;
        await store.incrementError(errorMsg);

        const newConfig = await store.getConfig();
        const exhausted = newConfig && newConfig.error_count >= ERROR_THRESHOLD;

        return { success: false, error: errorMsg, exhausted };
    }
}

/**
 * 测试 API 连通性
 */
export async function testConnection(store) {
    const result = await callLLM(store, [
        { role: 'user', content: '回复"ok"表示连接正常' },
    ], { max_tokens: 10 });

    if (result.success) {
        return { ok: true, msg: '✅ 连接成功！API 可正常调用。' };
    }

    let msg = '❌ 连接失败: ' + result.error;
    if (result.exhausted) {
        msg += '\n⚠️ API 已连续错误 ' + ERROR_THRESHOLD + ' 次，已标记为耗尽状态。请在日志频道查看详情。';
    }
    return { ok: false, msg };
}

/**
 * 检查 API 是否可用（返回 null 表示可用，否则返回错误信息）
 */
export async function checkApiHealth(store) {
    const config = await store.getConfig();
    if (!config || !config.api_key) return 'API Key 未配置';
    if (config.error_count >= ERROR_THRESHOLD) return 'API 已耗尽';
    return null;
}
