const grpc = require('@grpc/grpc-js');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const Task = require('../models/Task');
const database = require('../database/database');
const ProtoLoader = require('../utils/protoLoader');

class TaskService {
    constructor() {
        this.streamingSessions = new Map(); // Para gerenciar streams ativos
    }

    /**
     * Middleware para validação de token
     */
    async validateToken(token) {
        const jwtSecret = process.env.JWT_SECRET || 'seu-secret-aqui';
        try {
            return jwt.verify(token, jwtSecret);
        } catch (error) {
            throw new Error('Token inválido');
        }
    }

    /**
     * Criar tarefa
     */
    async createTask(call, callback) {
        try {
            const { token, title, description, priority } = call.request;
            
            // Validar token
            const user = await this.validateToken(token);
            
            if (!title?.trim()) {
                return callback(null, {
                    success: false,
                    message: 'Título é obrigatório',
                    errors: ['Título não pode estar vazio']
                });
            }

            const taskData = {
                id: uuidv4(),
                title: title.trim(),
                description: description || '',
                priority: ProtoLoader.convertFromPriority(priority),
                userId: user.id,
                completed: false
            };

            const task = new Task(taskData);
            const validation = task.validate();

            if (!validation.isValid) {
                return callback(null, {
                    success: false,
                    message: 'Dados inválidos',
                    errors: validation.errors
                });
            }

            await database.run(
                'INSERT INTO tasks (id, title, description, priority, userId) VALUES (?, ?, ?, ?, ?)',
                [task.id, task.title, task.description, task.priority, task.userId]
            );

            // Notificar streams ativos
            this.notifyStreams('TASK_CREATED', task);

            callback(null, {
                success: true,
                message: 'Tarefa criada com sucesso',
                task: task.toProtobuf()
            });
        } catch (error) {
            console.error('Erro ao criar tarefa:', error);
            const grpcError = new Error(error.message || 'Erro interno do servidor');
            grpcError.code = error.message === 'Token inválido' ? grpc.status.UNAUTHENTICATED : grpc.status.INTERNAL;
            callback(grpcError);
        }
    }

    /**
     * Listar tarefas com paginação
     */
    async getTasks(call, callback) {
        try {
            const { token, completed, priority, page, limit } = call.request;
            const user = await this.validateToken(token);

            let sql = 'SELECT * FROM tasks WHERE userId = ?';
            const params = [user.id];

            if (completed !== undefined && completed !== null) {
                sql += ' AND completed = ?';
                params.push(completed ? 1 : 0);
            }

            if (priority !== undefined && priority !== null) {
                const priorityStr = ProtoLoader.convertFromPriority(priority);
                sql += ' AND priority = ?';
                params.push(priorityStr);
            }

            sql += ' ORDER BY createdAt DESC';

            const pageNum = page || 1;
            const limitNum = Math.min(limit || 10, 100); // Máximo 100 por página

            const result = await database.getAllWithPagination(sql, params, pageNum, limitNum);
            const tasks = result.rows.map(row => {
                const task = new Task({...row, completed: row.completed === 1});
                return task.toProtobuf();
            });

            callback(null, {
                success: true,
                tasks: tasks,
                total: result.total,
                page: result.page,
                limit: result.limit
            });
        } catch (error) {
            console.error('Erro ao buscar tarefas:', error);
            const grpcError = new Error(error.message || 'Erro interno do servidor');
            grpcError.code = error.message === 'Token inválido' ? grpc.status.UNAUTHENTICATED : grpc.status.INTERNAL;
            callback(grpcError);
        }
    }

    /**
     * Buscar tarefa específica
     */
    async getTask(call, callback) {
        try {
            const { token, task_id } = call.request;
            const user = await this.validateToken(token);

            const row = await database.get(
                'SELECT * FROM tasks WHERE id = ? AND userId = ?',
                [task_id, user.id]
            );

            if (!row) {
                return callback(null, {
                    success: false,
                    message: 'Tarefa não encontrada'
                });
            }

            const task = new Task({...row, completed: row.completed === 1});
            
            callback(null, {
                success: true,
                message: 'Tarefa encontrada',
                task: task.toProtobuf()
            });
        } catch (error) {
            console.error('Erro ao buscar tarefa:', error);
            const grpcError = new Error(error.message || 'Erro interno do servidor');
            grpcError.code = error.message === 'Token inválido' ? grpc.status.UNAUTHENTICATED : grpc.status.INTERNAL;
            callback(grpcError);
        }
    }

    /**
     * Atualizar tarefa
     */
    async updateTask(call, callback) {
        try {
            const { token, task_id, title, description, completed, priority } = call.request;
            const user = await this.validateToken(token);

            // Verificar se a tarefa existe
            const existingTask = await database.get(
                'SELECT * FROM tasks WHERE id = ? AND userId = ?',
                [task_id, user.id]
            );

            if (!existingTask) {
                return callback(null, {
                    success: false,
                    message: 'Tarefa não encontrada'
                });
            }

            // Preparar dados para atualização
            const updateData = {
                title: title || existingTask.title,
                description: description !== undefined ? description : existingTask.description,
                completed: completed !== undefined ? completed : (existingTask.completed === 1),
                priority: priority !== undefined ? ProtoLoader.convertFromPriority(priority) : existingTask.priority
            };

            const result = await database.run(
                'UPDATE tasks SET title = ?, description = ?, completed = ?, priority = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?',
                [updateData.title, updateData.description, updateData.completed ? 1 : 0, updateData.priority, task_id, user.id]
            );

            if (result.changes === 0) {
                return callback(null, {
                    success: false,
                    message: 'Falha ao atualizar tarefa'
                });
            }

            // Buscar tarefa atualizada
            const updatedRow = await database.get(
                'SELECT * FROM tasks WHERE id = ? AND userId = ?',
                [task_id, user.id]
            );

            const task = new Task({...updatedRow, completed: updatedRow.completed === 1});
            
            // Notificar streams ativos
            this.notifyStreams('TASK_UPDATED', task);

            callback(null, {
                success: true,
                message: 'Tarefa atualizada com sucesso',
                task: task.toProtobuf()
            });
        } catch (error) {
            console.error('Erro ao atualizar tarefa:', error);
            const grpcError = new Error(error.message || 'Erro interno do servidor');
            grpcError.code = error.message === 'Token inválido' ? grpc.status.UNAUTHENTICATED : grpc.status.INTERNAL;
            callback(grpcError);
        }
    }

    /**
     * Deletar tarefa
     */
    async deleteTask(call, callback) {
        try {
            const { token, task_id } = call.request;
            const user = await this.validateToken(token);

            // Buscar tarefa antes de deletar (para notificações)
            const existingTask = await database.get(
                'SELECT * FROM tasks WHERE id = ? AND userId = ?',
                [task_id, user.id]
            );

            if (!existingTask) {
                return callback(null, {
                    success: false,
                    message: 'Tarefa não encontrada'
                });
            }

            const result = await database.run(
                'DELETE FROM tasks WHERE id = ? AND userId = ?',
                [task_id, user.id]
            );

            if (result.changes === 0) {
                return callback(null, {
                    success: false,
                    message: 'Falha ao deletar tarefa'
                });
            }

            const task = new Task({...existingTask, completed: existingTask.completed === 1});
            
            // Notificar streams ativos
            this.notifyStreams('TASK_DELETED', task);

            callback(null, {
                success: true,
                message: 'Tarefa deletada com sucesso'
            });
        } catch (error) {
            console.error('Erro ao deletar tarefa:', error);
            const grpcError = new Error(error.message || 'Erro interno do servidor');
            grpcError.code = error.message === 'Token inválido' ? grpc.status.UNAUTHENTICATED : grpc.status.INTERNAL;
            callback(grpcError);
        }
    }

    /**
     * Estatísticas das tarefas
     */
    async getTaskStats(call, callback) {
        try {
            const { token } = call.request;
            const user = await this.validateToken(token);

            const stats = await database.get(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) as pending
                FROM tasks WHERE userId = ?
            `, [user.id]);

            const completionRate = stats.total > 0 ? ((stats.completed / stats.total) * 100) : 0;

            callback(null, {
                success: true,
                stats: {
                    total: stats.total,
                    completed: stats.completed,
                    pending: stats.pending,
                    completion_rate: parseFloat(completionRate.toFixed(2))
                }
            });
        } catch (error) {
            console.error('Erro ao buscar estatísticas:', error);
            const grpcError = new Error(error.message || 'Erro interno do servidor');
            grpcError.code = error.message === 'Token inválido' ? grpc.status.UNAUTHENTICATED : grpc.status.INTERNAL;
            callback(grpcError);
        }
    }

    /**
     * Stream de tarefas (Server Streaming)
     * 
     * Demonstra como o gRPC permite streaming de dados,
     * possibilitando atualizações em tempo real
     */
    async streamTasks(call) {
        try {
            const { token, completed } = call.request;
            const user = await this.validateToken(token);

            let sql = 'SELECT * FROM tasks WHERE userId = ?';
            const params = [user.id];

            if (completed !== undefined && completed !== null) {
                sql += ' AND completed = ?';
                params.push(completed ? 1 : 0);
            }

            sql += ' ORDER BY createdAt DESC';

            const rows = await database.all(sql, params);

            // Enviar tarefas existentes
            for (const row of rows) {
                const task = new Task({...row, completed: row.completed === 1});
                call.write(task.toProtobuf());
                
                // Simular delay para demonstrar streaming
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Manter stream aberto para futuras atualizações
            const sessionId = uuidv4();
            this.streamingSessions.set(sessionId, {
                call,
                userId: user.id,
                filter: { completed }
            });

            call.on('cancelled', () => {
                this.streamingSessions.delete(sessionId);
                console.log(`Stream cancelado: ${sessionId}`);
            });

        } catch (error) {
            console.error('Erro no stream de tarefas:', error);
            call.destroy(new Error(error.message || 'Erro no streaming'));
        }
    }

    /**
     * Stream de notificações (Server Streaming)
     * 
     * Envia notificações em tempo real sobre mudanças nas tarefas
     */
    async streamNotifications(call) {
        try {
            const { token } = call.request;
            const user = await this.validateToken(token);

            const sessionId = uuidv4();
            
            this.streamingSessions.set(sessionId, {
                call,
                userId: user.id,
                type: 'notifications'
            });

            // Enviar mensagem inicial
            call.write({
                type: 0, // TASK_CREATED
                message: 'Stream de notificações iniciado',
                timestamp: Math.floor(Date.now() / 1000),
                task: null
            });

            call.on('cancelled', () => {
                this.streamingSessions.delete(sessionId);
                console.log(`Stream de notificações cancelado: ${sessionId}`);
            });

            call.on('error', (error) => {
                console.error('Erro no stream de notificações:', error);
                this.streamingSessions.delete(sessionId);
            });

        } catch (error) {
            console.error('Erro ao iniciar stream de notificações:', error);
            call.destroy(new Error(error.message || 'Erro no streaming'));
        }
    }

    /**
     * Notificar todos os streams ativos sobre mudanças
     */
    notifyStreams(action, task) {
        const notificationTypeMap = {
            'TASK_CREATED': 0,
            'TASK_UPDATED': 1,
            'TASK_DELETED': 2,
            'TASK_COMPLETED': 3
        };

        for (const [sessionId, session] of this.streamingSessions.entries()) {
            try {
                if (session.userId === task.userId) {
                    if (session.type === 'notifications') {
                        // Stream de notificações
                        session.call.write({
                            type: notificationTypeMap[action],
                            task: task.toProtobuf(),
                            message: `Tarefa ${action.toLowerCase().replace('_', ' ')}`,
                            timestamp: Math.floor(Date.now() / 1000)
                        });
                    } else if (session.filter) {
                        // Stream de tarefas com filtro
                        const { completed } = session.filter;
                        if (completed === undefined || completed === task.completed) {
                            if (action !== 'TASK_DELETED') {
                                session.call.write(task.toProtobuf());
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`Erro ao notificar stream ${sessionId}:`, error);
                this.streamingSessions.delete(sessionId);
            }
        }
    }
}

module.exports = TaskService;