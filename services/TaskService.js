// services/TaskService.js VERSÃO FINAL E CORRIGIDA

const grpc = require('@grpc/grpc-js');
const { v4: uuidv4 } = require('uuid');
const Task = require('../models/Task');
const database = require('../database/database');
const ProtoLoader = require('../utils/protoLoader');

class TaskService {
    constructor() {
        this.streamingSessions = new Map();
    }

    // Função de verificação de segurança
    _ensureAuthenticated(call, callback) {
        if (!call.user) {
            callback({
                code: grpc.status.UNAUTHENTICATED,
                message: 'Token de autenticação é obrigatório ou inválido.'
            });
            return false;
        }
        return true;
    }

    async createTask(call, callback) {
        try {
            if (!this._ensureAuthenticated(call, callback)) return;
            const user = call.user;
            const { title, description, priority } = call.request;

            if (!title?.trim()) {
                return callback(null, { success: false, message: 'Título é obrigatório', errors: ['Título não pode estar vazio'] });
            }
            // ... resto do código do método ...
            const taskData = { id: uuidv4(), title: title.trim(), description: description || '', priority: ProtoLoader.convertFromPriority(priority), userId: user.id, completed: false };
            const task = new Task(taskData);
            const validation = task.validate();
            if (!validation.isValid) { return callback(null, { success: false, message: 'Dados inválidos', errors: validation.errors }); }
            await database.run('INSERT INTO tasks (id, title, description, priority, userId) VALUES (?, ?, ?, ?, ?)', [task.id, task.title, task.description, task.priority, task.userId]);
            this.notifyStreams('TASK_CREATED', task);
            callback(null, { success: true, message: 'Tarefa criada com sucesso', task: task.toProtobuf() });
        } catch (error) {
            console.error('Erro ao criar tarefa:', error);
            callback({ code: grpc.status.INTERNAL, message: 'Erro interno do servidor' });
        }
    }

    async getTasks(call, callback) {
        try {
            // AQUI ESTÁ A VERIFICAÇÃO ESSENCIAL
            if (!this._ensureAuthenticated(call, callback)) return;
            
            const user = call.user;
            const { completed, priority, page, limit } = call.request;
            let sql = 'SELECT * FROM tasks WHERE userId = ?';
            const params = [user.id];
            if (completed !== undefined && completed !== null) { sql += ' AND completed = ?'; params.push(completed ? 1 : 0); }
            if (priority !== undefined && priority !== null) { const priorityStr = ProtoLoader.convertFromPriority(priority); sql += ' AND priority = ?'; params.push(priorityStr); }
            sql += ' ORDER BY createdAt DESC';
            const pageNum = page || 1;
            const limitNum = Math.min(limit || 10, 100);
            const result = await database.getAllWithPagination(sql, params, pageNum, limitNum);
            const tasks = result.rows.map(row => new Task({ ...row, completed: row.completed === 1 }).toProtobuf());
            callback(null, { success: true, tasks, total: result.total, page: result.page, limit: result.limit });
        } catch (error) {
            console.error('Erro ao buscar tarefas:', error);
            callback({ code: grpc.status.INTERNAL, message: error.message || 'Erro interno do servidor' });
        }
    }

    async getTask(call, callback) {
        try {
            if (!this._ensureAuthenticated(call, callback)) return;
            const user = call.user;
            const { task_id } = call.request;
            const row = await database.get('SELECT * FROM tasks WHERE id = ? AND userId = ?', [task_id, user.id]);
            if (!row) { return callback(null, { success: false, message: 'Tarefa não encontrada' }); }
            const task = new Task({ ...row, completed: row.completed === 1 });
            callback(null, { success: true, message: 'Tarefa encontrada', task: task.toProtobuf() });
        } catch (error) {
            console.error('Erro ao buscar tarefa:', error);
            callback({ code: grpc.status.INTERNAL, message: 'Erro interno do servidor' });
        }
    }

    async updateTask(call, callback) {
        try {
            if (!this._ensureAuthenticated(call, callback)) return;
            const user = call.user;
            const { task_id, title, description, completed, priority } = call.request;
            const existingTask = await database.get('SELECT * FROM tasks WHERE id = ? AND userId = ?', [task_id, user.id]);
            if (!existingTask) { return callback(null, { success: false, message: 'Tarefa não encontrada' }); }
            const updateData = { title: title ?? existingTask.title, description: description ?? existingTask.description, completed: completed ?? (existingTask.completed === 1), priority: priority !== undefined ? ProtoLoader.convertFromPriority(priority) : existingTask.priority };
            await database.run('UPDATE tasks SET title = ?, description = ?, completed = ?, priority = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?', [updateData.title, updateData.description, updateData.completed ? 1 : 0, updateData.priority, task_id, user.id]);
            const updatedRow = await database.get('SELECT * FROM tasks WHERE id = ?', [task_id]);
            const task = new Task({ ...updatedRow, completed: updatedRow.completed === 1 });
            this.notifyStreams('TASK_UPDATED', task);
            callback(null, { success: true, message: 'Tarefa atualizada com sucesso', task: task.toProtobuf() });
        } catch (error) {
            console.error('Erro ao atualizar tarefa:', error);
            callback({ code: grpc.status.INTERNAL, message: 'Erro interno do servidor' });
        }
    }

    async deleteTask(call, callback) {
        try {
            if (!this._ensureAuthenticated(call, callback)) return;
            const user = call.user;
            const { task_id } = call.request;
            const existingTask = await database.get('SELECT * FROM tasks WHERE id = ? AND userId = ?', [task_id, user.id]);
            if (!existingTask) { return callback(null, { success: false, message: 'Tarefa não encontrada' }); }
            const result = await database.run('DELETE FROM tasks WHERE id = ? AND userId = ?', [task_id, user.id]);
            if (result.changes === 0) { return callback(null, { success: false, message: 'Falha ao deletar tarefa' }); }
            const task = new Task({ ...existingTask, completed: existingTask.completed === 1 });
            this.notifyStreams('TASK_DELETED', task);
            callback(null, { success: true, message: 'Tarefa deletada com sucesso' });
        } catch (error) {
            console.error('Erro ao deletar tarefa:', error);
            callback({ code: grpc.status.INTERNAL, message: 'Erro interno do servidor' });
        }
    }

    async getTaskStats(call, callback) {
        try {
            if (!this._ensureAuthenticated(call, callback)) return;
            const user = call.user;
            const stats = await database.get(`SELECT COUNT(*) as total, SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) as pending FROM tasks WHERE userId = ?`, [user.id]);
            const completionRate = stats.total > 0 ? ((stats.completed / stats.total) * 100) : 0;
            callback(null, { success: true, stats: { total: stats.total || 0, completed: stats.completed || 0, pending: stats.pending || 0, completion_rate: parseFloat(completionRate.toFixed(2)) } });
        } catch (error) {
            console.error('Erro ao buscar estatísticas:', error);
            callback({ code: grpc.status.INTERNAL, message: 'Erro interno do servidor' });
        }
    }

    // Métodos de Streaming
    async streamTasks(call) {
        if (!this._ensureAuthenticated(call, (err) => call.destroy(err))) return;
        const user = call.user;
        const { completed } = call.request;
        // ... O resto do streaming ...
        try {
            let sql = 'SELECT * FROM tasks WHERE userId = ?';
            const params = [user.id];
            if (completed !== undefined && completed !== null) { sql += ' AND completed = ?'; params.push(completed ? 1 : 0); }
            sql += ' ORDER BY createdAt DESC';
            const rows = await database.all(sql, params);
            for (const row of rows) { const task = new Task({ ...row, completed: row.completed === 1 }); call.write(task.toProtobuf()); await new Promise(resolve => setTimeout(resolve, 50)); }
            const sessionId = uuidv4();
            this.streamingSessions.set(sessionId, { call, userId: user.id, filter: { completed } });
            call.on('cancelled', () => this.streamingSessions.delete(sessionId));
        } catch (error) {
            console.error('Erro no stream de tarefas:', error);
            call.destroy(new Error(error.message || 'Erro no streaming'));
        }
    }
    
    async streamNotifications(call) {
        if (!this._ensureAuthenticated(call, (err) => call.destroy(err))) return;
        const user = call.user;
        // ... O resto do streaming ...
        try {
            const sessionId = uuidv4();
            this.streamingSessions.set(sessionId, { call, userId: user.id, type: 'notifications' });
            call.write({ type: 'TASK_CREATED', message: 'Stream de notificações iniciado', timestamp: Math.floor(Date.now() / 1000), task: null });
            call.on('cancelled', () => this.streamingSessions.delete(sessionId));
            call.on('error', (err) => { console.error(`Erro no stream de notificações ${sessionId}:`, err); this.streamingSessions.delete(sessionId); });
        } catch (error) {
            console.error('Erro ao iniciar stream de notificações:', error);
            call.destroy(new Error(error.message || 'Erro no streaming'));
        }
    }
    
    notifyStreams(action, task) {
        const notificationTypeMap = { 'TASK_CREATED': 0, 'TASK_UPDATED': 1, 'TASK_DELETED': 2, 'TASK_COMPLETED': 3 };
        for (const [sessionId, session] of this.streamingSessions.entries()) {
            try {
                if (session.userId === task.userId && session.type === 'notifications') {
                    session.call.write({ type: notificationTypeMap[action], task: task.toProtobuf(), message: `Tarefa ${action.toLowerCase().replace('_', ' ')}`, timestamp: Math.floor(Date.now() / 1000) });
                }
            } catch (error) {
                console.error(`Erro ao notificar stream ${sessionId}:`, error);
                this.streamingSessions.delete(sessionId);
            }
        }
    }
}

module.exports = TaskService;