const ProtoLoader = require('../utils/protoLoader');

class Task {
    constructor(data) {
        this.id = data.id;
        this.title = data.title;
        this.description = data.description || '';
        this.completed = data.completed || false;
        this.priority = data.priority || 'medium';
        this.userId = data.userId || data.user_id;
        this.createdAt = data.createdAt || data.created_at;
        this.updatedAt = data.updatedAt || data.updated_at;
    }

    validate() {
        const errors = [];
        if (!this.title?.trim()) errors.push('Título é obrigatório');
        if (!this.userId) errors.push('Usuário é obrigatório');
        if (!['low', 'medium', 'high', 'urgent'].includes(this.priority)) {
            errors.push('Prioridade deve ser: low, medium, high ou urgent');
        }
        return { isValid: errors.length === 0, errors };
    }

    // Converter para formato Protobuf
    toProtobuf() {
        return {
            id: this.id,
            title: this.title,
            description: this.description,
            completed: this.completed,
            priority: ProtoLoader.convertPriority(this.priority),
            user_id: this.userId,
            created_at: this.createdAt ? Math.floor(new Date(this.createdAt).getTime() / 1000) : 0,
            updated_at: this.updatedAt ? Math.floor(new Date(this.updatedAt).getTime() / 1000) : 0
        };
    }

    // Converter de formato Protobuf
    static fromProtobuf(protoTask) {
        return new Task({
            id: protoTask.id,
            title: protoTask.title,
            description: protoTask.description,
            completed: protoTask.completed,
            priority: ProtoLoader.convertFromPriority(protoTask.priority),
            user_id: protoTask.user_id,
            created_at: protoTask.created_at,
            updated_at: protoTask.updated_at
        });
    }

    toJSON() {
        return { ...this };
    }
}

module.exports = Task;