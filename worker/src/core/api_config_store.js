/**
 * LLM API 配置存储（Workers 版）
 *
 * 原网关版 db/api_config_db.js 把单行配置存在本地 SQLite 的 api_config 表；
 * Workers 版迁进 Supabase 的 api_config 表（结构相同，单行 id=1）。
 * 方法与原版一一对应，换 API 面板与 LLM 调用方的逻辑不用改。
 *
 * 建表 SQL 见 worker/sql/schema.sql。
 */

export const PROVIDER_DEFAULTS = {
    deepseek: { base_url: 'https://api.deepseek.com/v1',        model: 'deepseek-chat' },
    openai:   { base_url: 'https://api.openai.com/v1',          model: 'gpt-4o-mini' },
    qwen:     { base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    zhipu:    { base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    custom:   { base_url: '',                                    model: '' },
};

export function createApiConfigStore(supabase) {
    const store = {
        async getConfig() {
            const { data, error } = await supabase
                .from('api_config')
                .select('*')
                .eq('id', 1)
                .maybeSingle();
            if (error) throw error;
            if (data) return data;

            // 首次使用：按原版默认行落库
            const row = {
                id: 1,
                provider: 'deepseek',
                base_url: PROVIDER_DEFAULTS.deepseek.base_url,
                api_key: '',
                model: PROVIDER_DEFAULTS.deepseek.model,
                error_count: 0,
                last_error: '',
                last_error_time: '',
                updated_at: '',
            };
            await supabase.from('api_config').insert(row);
            return row;
        },

        async updateConfig({ provider, base_url, api_key, model }) {
            const now = new Date().toISOString();
            const { error } = await supabase
                .from('api_config')
                .update({
                    provider, base_url, api_key, model,
                    error_count: 0, last_error: '', last_error_time: '', updated_at: now,
                })
                .eq('id', 1);
            if (error) throw error;
            return true;
        },

        async setProvider(provider) {
            const defaults = PROVIDER_DEFAULTS[provider];
            if (!defaults) throw new Error('未知的提供商: ' + provider);
            const existing = await store.getConfig();
            return store.updateConfig({
                provider, base_url: defaults.base_url,
                api_key: existing?.api_key || '', model: defaults.model,
            });
        },

        async setApiKey(apiKey) {
            const c = await store.getConfig();
            if (!c) return;
            return store.updateConfig({ provider: c.provider, base_url: c.base_url, api_key: apiKey, model: c.model });
        },

        async setModel(model) {
            const c = await store.getConfig();
            if (!c) return;
            return store.updateConfig({ provider: c.provider, base_url: c.base_url, api_key: c.api_key, model });
        },

        async setCustomBaseUrl(baseUrl) {
            const c = await store.getConfig();
            if (!c) return;
            return store.updateConfig({
                provider: 'custom',
                base_url: baseUrl,
                api_key: c.api_key,
                model: c.model || '',
            });
        },

        async incrementError(msg) {
            const now = new Date().toISOString();
            const c = await store.getConfig();
            const { error } = await supabase
                .from('api_config')
                .update({ error_count: (c?.error_count || 0) + 1, last_error: msg, last_error_time: now })
                .eq('id', 1);
            if (error) throw error;
            return true;
        },

        async resetErrors() {
            const { error } = await supabase
                .from('api_config')
                .update({ error_count: 0, last_error: '', last_error_time: '' })
                .eq('id', 1);
            if (error) throw error;
            return true;
        },

        getDefaults() { return PROVIDER_DEFAULTS; },
    };
    return store;
}
