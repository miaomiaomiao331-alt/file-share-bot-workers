const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const PROVIDER_DEFAULTS = {
    deepseek: { base_url: 'https://api.deepseek.com/v1',        model: 'deepseek-chat' },
    openai:   { base_url: 'https://api.openai.com/v1',          model: 'gpt-4o-mini' },
    qwen:     { base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    zhipu:    { base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    custom:   { base_url: '',                                    model: '' },
};

class ApiConfigDB {
    constructor() {
        this.dbPath = path.join(__dirname, '../data/shared_files.sqlite');
        this.db = null;
    }
async setCustomBaseUrl(baseUrl) {
    const c = await this.getConfig();
    if (!c) return;
    return this.updateConfig({
        provider: 'custom',
        base_url: baseUrl,
        api_key: c.api_key,
        model: c.model || ''
    });
}
    async initDB() {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) { reject(err); return; }
                this.db.serialize(() => {
                    this.db.run(`CREATE TABLE IF NOT EXISTS api_config (
                        id INTEGER PRIMARY KEY CHECK(id = 1),
                        provider TEXT NOT NULL DEFAULT 'deepseek',
                        base_url TEXT NOT NULL DEFAULT '',
                        api_key TEXT NOT NULL DEFAULT '',
                        model TEXT NOT NULL DEFAULT '',
                        error_count INTEGER DEFAULT 0,
                        last_error TEXT DEFAULT '',
                        last_error_time TEXT DEFAULT '',
                        updated_at TEXT DEFAULT ''
                    )`);
                    this.db.run(`INSERT OR IGNORE INTO api_config (id, provider, base_url, api_key, model)
                        VALUES (1, 'deepseek', 'https://api.deepseek.com/v1', '', 'deepseek-chat')`,
                        (err) => {
                            if (err) reject(err);
                            else resolve(this.db);
                        }
                    );
                });
            });
        });
    }

    async getConfig() {
        await this.initDB();
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT * FROM api_config WHERE id = 1`, [], (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });
    }

    async updateConfig({ provider, base_url, api_key, model }) {
        await this.initDB();
        const now = new Date().toISOString();
        return new Promise((resolve, reject) => {
            this.db.run(`UPDATE api_config SET provider=?, base_url=?, api_key=?, model=?,
                error_count=0, last_error='', last_error_time='', updated_at=? WHERE id=1`,
                [provider, base_url, api_key, model, now],
                (err) => err ? reject(err) : resolve(true));
        });
    }

    async setProvider(provider) {
        const defaults = PROVIDER_DEFAULTS[provider];
        if (!defaults) throw new Error('未知的提供商: ' + provider);
        const existing = await this.getConfig();
        return this.updateConfig({
            provider, base_url: defaults.base_url,
            api_key: existing?.api_key || '', model: defaults.model,
        });
    }

    async setApiKey(apiKey) {
        const c = await this.getConfig(); if (!c) return;
        return this.updateConfig({ provider: c.provider, base_url: c.base_url, api_key: apiKey, model: c.model });
    }

    async setModel(model) {
        const c = await this.getConfig(); if (!c) return;
        return this.updateConfig({ provider: c.provider, base_url: c.base_url, api_key: c.api_key, model });
    }

    async incrementError(msg) {
        await this.initDB();
        const now = new Date().toISOString();
        return new Promise((resolve, reject) => {
            this.db.run(`UPDATE api_config SET error_count=error_count+1, last_error=?, last_error_time=? WHERE id=1`,
                [msg, now], (err) => err ? reject(err) : resolve(true));
        });
    }

    async resetErrors() {
        await this.initDB();
        return new Promise((resolve, reject) => {
            this.db.run(`UPDATE api_config SET error_count=0, last_error='', last_error_time='' WHERE id=1`,
                [], (err) => err ? reject(err) : resolve(true));
        });
    }

    getDefaults() { return PROVIDER_DEFAULTS; }
}

let instance = null;
module.exports = {
    getApiConfigDb: () => { if (!instance) instance = new ApiConfigDB(); return instance; }
};
