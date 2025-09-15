const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor() {
        this.dbPath = path.join(__dirname, 'tasks_grpc.db');
        this.db = null;
    }

    async init() {
        this.db = new sqlite3.Database(this.dbPath);
        await this.createTables();
        console.log('✅ Database gRPC inicializado');
    }

    async createTables() {
        const userTable = `
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                firstName TEXT NOT NULL,
                lastName TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )`;

        const taskTable = `
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                completed INTEGER DEFAULT 0,
                priority TEXT DEFAULT 'medium',
                userId TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (userId) REFERENCES users (id)
            )`;

        return Promise.all([
            this.run(userTable),
            this.run(taskTable)
        ]);
    }

    // Métodos auxiliares para promisificar SQLite
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Método específico para paginação
    async getAllWithPagination(sql, params, page = 1, limit = 10) {
        const offset = (page - 1) * limit;
        const paginatedSql = `${sql} LIMIT ? OFFSET ?`;
        const countSql = sql.replace(/SELECT.*FROM/, 'SELECT COUNT(*) as count FROM');
        
        const [rows, countResult] = await Promise.all([
            this.all(paginatedSql, [...params, limit, offset]),
            this.get(countSql, params)
        ]);

        return {
            rows,
            total: countResult.count,
            page,
            limit,
            totalPages: Math.ceil(countResult.count / limit)
        };
    }
}

module.exports = new Database();