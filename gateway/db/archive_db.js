const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class ArchiveDB {
    constructor() {
        this.dbPath = path.join(__dirname, '../data/shared_files.sqlite');
        this.db = null;
    }

    async initDB() {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) { reject(err); return; }
                resolve(this.db);
            });
        });
    }

    async saveFile({ file_name, file_url, storage_message_id, storage_channel_id, tags, uploader_id, file_size, file_type }) {
        await this.initDB();
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO archive_files (file_name, file_url, storage_message_id, storage_channel_id, tags, uploader_id, upload_time, file_size, file_type, chunk_urls)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    file_name, file_url, storage_message_id || '', storage_channel_id || '',
                    JSON.stringify(tags || []), uploader_id, new Date().toISOString(),
                    file_size || 0, file_type || '',
                    arguments[0].chunk_urls ? JSON.stringify(arguments[0].chunk_urls) : ''
                ],
                function (err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, ...arguments });
                }
            );
        });
    }

    /** 使用命名参数方式 */
    async saveFileV2(params) {
        await this.initDB();
        const { file_name, file_url, storage_message_id, storage_channel_id, tags, uploader_id, file_size, file_type, chunk_urls } = params;
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO archive_files (file_name, file_url, storage_message_id, storage_channel_id, tags, uploader_id, upload_time, file_size, file_type, chunk_urls)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    file_name, file_url, storage_message_id || '', storage_channel_id || '',
                    JSON.stringify(tags || []), uploader_id, new Date().toISOString(),
                    file_size || 0, file_type || '',
                    chunk_urls && chunk_urls.length > 0 ? JSON.stringify(chunk_urls) : ''
                ],
                function (err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });
    }

    async saveCharacterCard(file_id, character_name, character_json) {
        await this.initDB();
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO character_cards (file_id, character_name, character_json) VALUES (?, ?, ?)`,
                [file_id, character_name, character_json || ''],
                function (err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                }
            );
        });
    }

    async searchByTags(tagList, page = 1, pageSize = 10) {
        await this.initDB();
        const offset = (page - 1) * pageSize;
        const lowerTags = tagList.map(t => t.toLowerCase());

        return new Promise((resolve, reject) => {
            // Get all files (for simplicity with JSON tag matching in SQLite)
            this.db.all(`SELECT * FROM archive_files ORDER BY upload_time DESC`, [], (err, rows) => {
                if (err) return reject(err);
                // Filter in JS for tag matching
                const filtered = rows.filter(row => {
                    let fileTags;
                    try { fileTags = JSON.parse(row.tags); } catch { fileTags = []; }
                    const lowerFileTags = fileTags.map(t => t.toLowerCase());
                    return lowerTags.every(t => lowerFileTags.some(ft => ft.includes(t)));
                });

                const total = filtered.length;
                const paged = filtered.slice(offset, offset + pageSize);

                resolve({
                    files: paged,
                    total,
                    page,
                    pageSize,
                    totalPages: Math.ceil(total / pageSize) || 1
                });
            });
        });
    }

    async searchCharacterCards(nameQuery, page = 1, pageSize = 10) {
        await this.initDB();
        const offset = (page - 1) * pageSize;
        const lowerQuery = nameQuery.toLowerCase();

        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT c.*, a.file_name, a.file_url, a.tags, a.uploader_id, a.upload_time, a.file_size, a.file_type, a.storage_message_id, a.storage_channel_id
                 FROM character_cards c
                 JOIN archive_files a ON c.file_id = a.id
                 ORDER BY c.character_name ASC`,
                [],
                (err, rows) => {
                    if (err) return reject(err);
                    const filtered = rows.filter(row =>
                        row.character_name.toLowerCase().includes(lowerQuery)
                    );
                    const total = filtered.length;
                    const paged = filtered.slice(offset, offset + pageSize);
                    resolve({
                        cards: paged,
                        total,
                        page,
                        pageSize,
                        totalPages: Math.ceil(total / pageSize) || 1
                    });
                }
            );
        });
    }

    async getAllTags() {
        await this.initDB();
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT tags FROM archive_files`, [], (err, rows) => {
                if (err) return reject(err);
                const tagSet = new Set();
                for (const row of rows) {
                    try {
                        const fileTags = JSON.parse(row.tags);
                        fileTags.forEach(t => tagSet.add(t));
                    } catch {}
                }
                resolve([...tagSet].sort());
            });
        });
    }
}

let instance = null;

module.exports = {
    getArchiveDb: () => {
        if (!instance) instance = new ArchiveDB();
        return instance;
    }
};
