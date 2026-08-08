const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'fantalega.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;

function getDb() {
    if (db) return db;

    fs.mkdirSync(DATA_DIR, { recursive: true });
    const isNewDb = !fs.existsSync(DB_PATH);

    db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');

    if (isNewDb) {
        db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    }

    return db;
}

module.exports = { getDb, DB_PATH };
