const grpc = require('@grpc/grpc-js');
const ProtoLoader = require('./utils/protoLoader');

/**
 * Cliente gRPC de Exemplo
 * 
 * Demonstra como consumir serviços gRPC de forma eficiente,
 * incluindo streaming de dados em tempo real
 */

class GrpcClient {
    constructor(serverAddress = 'localhost:50051', options = {}) {
        this.serverAddress = serverAddress;
        this.protoLoader = new ProtoLoader();
        this.authClient = null;
        this.taskClient = null;
        this.chatClient = null;
        this.currentToken = null;
        this.options = options; // { roundRobin: true, addresses: ['host1:50051','host2:50051'] }
    }

    createAuthInterceptor() {
        const self = this;
        // client-side interceptor to inject metadata
        return (options, nextCall) => {
            const requester = {
                start: (metadata, listener, next) => {
                    // adicionar Authorization
                    if (self.currentToken) {
                        metadata.add('authorization', `Bearer ${self.currentToken}`);
                    }
                    next(metadata, listener);
                }
            };
            return new grpc.InterceptingCall(nextCall(options), requester);
        };
    }

    async initialize() {
        try {
            const authProto = this.protoLoader.loadProto('auth_service.proto', 'auth');
            const taskProto = this.protoLoader.loadProto('task_service.proto', 'tasks');
            const chatProto = this.protoLoader.loadProto('chat_service.proto', 'chat');

            const credentials = grpc.credentials.createInsecure();

            // Channel options (round_robin)
            const channelOptions = {};
            if (this.options.roundRobin) {
                channelOptions['grpc.service_config'] = JSON.stringify({
                    loadBalancingConfig: [{ round_robin: {} }]
                });
            }

            // If the user passed an array of addresses, use target string "dns:///<name>" or pick first
            let target = this.serverAddress;
            if (Array.isArray(this.options.addresses) && this.options.addresses.length > 0) {
                // create a target with multiple addresses via 'ipv4:...' isn't directly available;
                // simplest: if you run multiple backends behind DNS that returns multiple A records,
                // set serverAddress to the DNS name and enable round_robin above.
                target = this.options.addresses[0];
            }

            // cria clients com interceptors (injetar token)
            const interceptorProviders = [this.createAuthInterceptor()];
            const callOptions = { 'grpc.default_authority': undefined, ...channelOptions };

            this.authClient = new authProto.AuthService(target, credentials, callOptions);
            this.taskClient = new taskProto.TaskService(target, credentials, callOptions);
            this.chatClient = new chatProto.ChatService(target, credentials, callOptions);

            // NOTE: @grpc/grpc-js interceptors are provided per-call via InterceptingCall wrapper above.
            // We'll use metadata injection interceptor created earlier when using client directly in promisify.

            console.log('✅ Cliente gRPC inicializado');
        } catch (error) {
            console.error('❌ Erro na inicialização do cliente:', error);
            throw error;
        }
    }

    // Promisificar chamadas gRPC
    promisify(client, method) {
        const self = this;
        return (request) => {
            return new Promise((resolve, reject) => {
                const metadata = new grpc.Metadata();
                if (self.currentToken) metadata.add('authorization', `Bearer ${self.currentToken}`);

                client[method](request, metadata, (error, response) => {
                    if (error) reject(error);
                    else resolve(response);
                });
            });
        };
    }

    startChat(onMessage) {
        const metadata = new grpc.Metadata();
        if (this.currentToken) metadata.add('authorization', `Bearer ${this.currentToken}`);

        const stream = this.chatClient.Chat(metadata);

        stream.on('data', (msg) => {
            if (onMessage) onMessage(msg);
        });

        stream.on('end', () => console.log('Chat stream ended'));
        stream.on('error', (err) => console.error('Chat stream error', err));
        stream.on('status', (status) => console.log('Chat stream status', status));

        return {
            write: (text) => {
                const msg = {
                    id: undefined,
                    text,
                    timestamp: Math.floor(Date.now() / 1000)
                };
                stream.write(msg);
            },
            raw: stream,
            end: () => stream.end()
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
            this.currentToken = response.token;
            console.log('🔑 Token obtido com sucesso');
        }

        return response;
    }

    async createTask(taskData) {
        const createPromise = this.promisify(this.taskClient, 'CreateTask');
        // O token já é enviado nos metadados pela função promisify
        return await createPromise(taskData);
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