const grpc = require('@grpc/grpc-js');
const ProtoLoader = require('./utils/protoLoader');

/**
 * Cliente gRPC de Exemplo
 * 
 * Demonstra como consumir serviços gRPC de forma eficiente,
 * incluindo streaming de dados em tempo real
 */

class GrpcClient {
    constructor(serverAddress = 'localhost:50051') {
        this.serverAddress = serverAddress;
        this.protoLoader = new ProtoLoader();
        this.authClient = null;
        this.taskClient = null;
        this.currentToken = null;
    }

    async initialize() {
        try {
            // Carregar protobuf
            const authProto = this.protoLoader.loadProto('auth_service.proto', 'auth');
            const taskProto = this.protoLoader.loadProto('task_service.proto', 'tasks');

            // Criar clientes
            const credentials = grpc.credentials.createInsecure();
            
            this.authClient = new authProto.AuthService(this.serverAddress, credentials);
            this.taskClient = new taskProto.TaskService(this.serverAddress, credentials);

            console.log('✅ Cliente gRPC inicializado');
        } catch (error) {
            console.error('❌ Erro na inicialização do cliente:', error);
            throw error;
        }
    }

    // Promisificar chamadas gRPC
    promisify(client, method) {
        return (request) => {
            return new Promise((resolve, reject) => {
                client[method](request, (error, response) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(response);
                    }
                });
            });
        };
    }

    async register(userData) {
        const registerPromise = this.promisify(this.authClient, 'Register');
        return await registerPromise(userData);
    }

    async login(credentials) {
        const loginPromise = this.promisify(this.authClient, 'Login');
        const response = await loginPromise(credentials);
        
        if (response.success) {
            this.currentToken = response.token;
            console.log('🔑 Token obtido com sucesso');
        }
        
        return response;
    }

    async createTask(taskData) {
        const createPromise = this.promisify(this.taskClient, 'CreateTask');
        return await createPromise({
            token: this.currentToken,
            ...taskData
        });
    }

    async getTasks(filters = {}) {
        const getTasksPromise = this.promisify(this.taskClient, 'GetTasks');
        return await getTasksPromise({
            token: this.currentToken,
            ...filters
        });
    }

    async getTask(taskId) {
        const getTaskPromise = this.promisify(this.taskClient, 'GetTask');
        return await getTaskPromise({
            token: this.currentToken,
            task_id: taskId
        });
    }

    async updateTask(taskId, updates) {
        const updatePromise = this.promisify(this.taskClient, 'UpdateTask');
        return await updatePromise({
            token: this.currentToken,
            task_id: taskId,
            ...updates
        });
    }

    async deleteTask(taskId) {
        const deletePromise = this.promisify(this.taskClient, 'DeleteTask');
        return await deletePromise({
            token: this.currentToken,
            task_id: taskId
        });
    }

    async getStats() {
        const statsPromise = this.promisify(this.taskClient, 'GetTaskStats');
        return await statsPromise({
            token: this.currentToken
        });
    }

    // Demonstração de streaming
    streamTasks(filters = {}) {
        const stream = this.taskClient.StreamTasks({
            token: this.currentToken,
            ...filters
        });

        stream.on('data', (task) => {
            console.log('📋 Tarefa recebida via stream:', {
                id: task.id,
                title: task.title,
                completed: task.completed
            });
        });

        stream.on('end', () => {
            console.log('📋 Stream de tarefas finalizado');
        });

        stream.on('error', (error) => {
            console.error('❌ Erro no stream de tarefas:', error);
        });

        return stream;
    }

    streamNotifications() {
        const stream = this.taskClient.StreamNotifications({
            token: this.currentToken
        });

        stream.on('data', (notification) => {
            const typeMap = ['CREATED', 'UPDATED', 'DELETED', 'COMPLETED'];
            console.log('🔔 Notificação:', {
                type: typeMap[notification.type],
                message: notification.message,
                task: notification.task ? notification.task.title : null,
                timestamp: new Date(parseInt(notification.timestamp) * 1000)
            });
        });

        stream.on('end', () => {
            console.log('🔔 Stream de notificações finalizado');
        });

        stream.on('error', (error) => {
            console.error('❌ Erro no stream de notificações:', error);
        });

        return stream;
    }
}

// Demonstração de uso
async function demonstrateGrpcClient() {
    const client = new GrpcClient();
    
    try {
        await client.initialize();

        // 1. Registrar usuário
        console.log('\n1. Registrando usuário...');
        const registerResponse = await client.register({
            email: 'usuario@teste.com',
            username: 'usuarioteste',
            password: 'senha123',
            first_name: 'João',
            last_name: 'Silva'
        });
        console.log('Registro:', registerResponse.message);

        // 2. Fazer login
        console.log('\n2. Fazendo login...');
        const loginResponse = await client.login({
            identifier: 'usuario@teste.com',
            password: 'senha123'
        });
        console.log('Login:', loginResponse.message);

        if (!loginResponse.success) {
            // Tentar login com usuário existente
            console.log('Tentando login novamente...');
            await client.login({
                identifier: 'usuario@teste.com',
                password: 'senha123'
            });
        }

        // 3. Criar tarefa
        console.log('\n3. Criando tarefa...');
        const createResponse = await client.createTask({
            title: 'Estudar gRPC',
            description: 'Aprender Protocol Buffers e streaming',
            priority: 2 // HIGH
        });
        console.log('Tarefa criada:', createResponse.message);

        // 4. Listar tarefas
        console.log('\n4. Listando tarefas...');
        const tasksResponse = await client.getTasks({ page: 1, limit: 10 });
        console.log(`Encontradas ${tasksResponse.tasks.length} tarefas`);

        // 5. Buscar tarefa específica
        if (tasksResponse.tasks.length > 0) {
            console.log('\n5. Buscando tarefa específica...');
            const taskResponse = await client.getTask(tasksResponse.tasks[0].id);
            console.log('Tarefa encontrada:', taskResponse.task.title);
        }

        // 6. Estatísticas
        console.log('\n6. Estatísticas...');
        const statsResponse = await client.getStats();
        console.log('Stats:', statsResponse.stats);

        // 7. Demonstrar streaming (comentado para evitar loop infinito)
        // console.log('\n7. Iniciando stream de notificações...');
        // const notificationStream = client.streamNotifications();
        
        // Manter stream aberto por alguns segundos
        // setTimeout(() => notificationStream.cancel(), 5000);

    } catch (error) {
        console.error('❌ Erro na demonstração:', error);
    }
}

// Executar demonstração se arquivo for executado diretamente
if (require.main === module) {
    demonstrateGrpcClient();
}

module.exports = GrpcClient;