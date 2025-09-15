// client.js - VERSÃO FINAL E CORRIGIDA

const grpc = require('@grpc/grpc-js');
const ProtoLoader = require('./utils/protoLoader');

class GrpcClient {
    constructor(serverAddress = 'localhost:50051', options = {}) {
        this.serverAddress = serverAddress;
        this.protoLoader = new ProtoLoader();
        this.authClient = null;
        this.taskClient = null;
        this.chatClient = null;
        this.currentToken = null;
        this.options = options;
    }

    async initialize() {
        try {
            const authProto = this.protoLoader.loadProto('auth_service.proto', 'auth');
            const taskProto = this.protoLoader.loadProto('task_service.proto', 'tasks');
            const chatProto = this.protoLoader.loadProto('chat_service.proto', 'chat');

            const credentials = grpc.credentials.createInsecure();
            
            // A inicialização dos clientes é mais simples
            this.authClient = new authProto.AuthService(this.serverAddress, credentials);
            this.taskClient = new taskProto.TaskService(this.serverAddress, credentials);
            this.chatClient = new chatProto.ChatService(this.serverAddress, credentials);

            console.log('✅ Cliente gRPC inicializado');
        } catch (error) {
            console.error('❌ Erro na inicialização do cliente:', error);
            throw error;
        }
    }

    // A MUDANÇA CRUCIAL ESTÁ AQUI
    _getGrpcMetadata() {
        const metadata = new grpc.Metadata();
        if (this.currentToken) {
            // Garante que o cabeçalho é enviado da forma que o interceptor espera
            metadata.set('authorization', `Bearer ${this.currentToken}`);
        }
        return metadata;
    }

    promisify(client, method) {
        return (request) => {
            return new Promise((resolve, reject) => {
                // Usa a nova função para pegar os metadados
                client[method](request, this._getGrpcMetadata(), (error, response) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(response);
                    }
                });
            });
        };
    }

    setToken(token) {
        this.currentToken = token;
    }

    async register(userData) {
        const registerPromise = this.promisify(this.authClient, 'Register');
        return await registerPromise(userData);
    }

    async login(credentials) {
        const loginPromise = this.promisify(this.authClient, 'Login');
        const response = await loginPromise(credentials);
        
        if (response.success) {
            this.setToken(response.token); // Usa o método setToken
            console.log('🔑 Token obtido com sucesso');
        }
        
        return response;
    }

    async createTask(taskData) {
        // Remove o token do corpo da requisição, ele vai apenas nos metadados
        const { token, ...data } = taskData;
        const createPromise = this.promisify(this.taskClient, 'CreateTask');
        return await createPromise(data);
    }

    async getTasks(filters = {}) {
        const { token, ...data } = filters;
        const getTasksPromise = this.promisify(this.taskClient, 'GetTasks');
        return await getTasksPromise(data);
    }

    async getTask(taskId) {
        const getTaskPromise = this.promisify(this.taskClient, 'GetTask');
        return await getTaskPromise({ task_id: taskId });
    }

    async updateTask(taskId, updates) {
        const { token, ...data } = updates;
        const updatePromise = this.promisify(this.taskClient, 'UpdateTask');
        return await updatePromise({ task_id: taskId, ...data });
    }

    async deleteTask(taskId) {
        const deletePromise = this.promisify(this.taskClient, 'DeleteTask');
        return await deletePromise({ task_id: taskId });
    }

    async getStats() {
        const statsPromise = this.promisify(this.taskClient, 'GetTaskStats');
        return await statsPromise({});
    }

    // Métodos de streaming também precisam dos metadados
    streamTasks(filters = {}) {
        const { token, ...data } = filters;
        return this.taskClient.StreamTasks(data, this._getGrpcMetadata());
    }

    streamNotifications() {
        return this.taskClient.StreamNotifications({}, this._getGrpcMetadata());
    }

    startChat(onMessage) {
        const stream = this.chatClient.Chat(this._getGrpcMetadata());
        stream.on('data', (msg) => onMessage && onMessage(msg));
        stream.on('end', () => console.log('Chat stream ended'));
        stream.on('error', (err) => console.error('Chat stream error', err));
        return {
            write: (text) => stream.write({ text }),
            end: () => stream.end()
        };
    }
}


// O módulo de demonstração não é necessário para o teste, mas pode ser mantido
// Demonstração de uso
async function demonstrateGrpcClient() {
    // ...
}
if (require.main !== module) { // Garante que a demo não rode durante os testes
    // module.exports = GrpcClient;
} else {
    // demonstrateGrpcClient();
}

module.exports = GrpcClient;