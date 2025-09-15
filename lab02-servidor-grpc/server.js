const grpc = require('@grpc/grpc-js');
const ProtoLoader = require('./utils/protoLoader');
const AuthService = require('./services/AuthService');
const TaskService = require('./services/TaskService');
const ChatService = require('./services/ChatService'); // novo
const database = require('./database/database');
const { serverAuthInterceptor } = require('./middleware/auth');
const { toGrpcError } = require('./utils/grpcErrors');

class GrpcServer {
    constructor() {
        this.server = new grpc.Server();
        this.protoLoader = new ProtoLoader();
        this.authService = new AuthService();
        this.taskService = new TaskService();
        this.chatService = new ChatService();
    }

    // helper para aplicar interceptors (simples)
    wrapHandlerWithInterceptor(handler, interceptors = []) {
        // handler: function(call, callback) OR function(call) for streams
        return (call, callback) => {
            // executar interceptors em cadeia
            let idx = 0;
            const next = () => {
                if (idx >= interceptors.length) {
                    // chamar handler
                    try {
                        return handler.call(this, call, callback);
                    } catch (error) {
                        const gErr = toGrpcError(error);
                        if (callback) return callback(gErr);
                        try { call.destroy(gErr); } catch (e) {}
                    }
                } else {
                    const interceptor = interceptors[idx++];
                    try {
                        // interceptors podem ser sync ou retornar next(call)
                        interceptor(call, null, (c, cb) => next(c, cb));
                    } catch (err) {
                        const gErr = toGrpcError(err);
                        if (callback) return callback(gErr);
                        try { call.destroy(gErr); } catch (e) {}
                    }
                }
            };
            next();
        };
    }

    async initialize() {
        try {
            await database.init();

            const authProto = this.protoLoader.loadProto('auth_service.proto', 'auth');
            const taskProto = this.protoLoader.loadProto('task_service.proto', 'tasks');
            const chatProto = this.protoLoader.loadProto('chat_service.proto', 'chat'); // novo

            // registrar AuthService (permitir endpoints públicos sem metadata)
            this.server.addService(authProto.AuthService.service, {
                Register: this.wrapHandlerWithInterceptor(this.authService.register.bind(this.authService), []),
                Login: this.wrapHandlerWithInterceptor(this.authService.login.bind(this.authService), []),
                ValidateToken: this.wrapHandlerWithInterceptor(this.authService.validateToken.bind(this.authService), [])
            });

            // registrar TaskService com interceptor de auth
            const authInterceptor = serverAuthInterceptor({ skipMethods: ['/auth.AuthService/Register', '/auth.AuthService/Login'] });
            this.server.addService(taskProto.TaskService.service, {
                CreateTask: this.wrapHandlerWithInterceptor(this.taskService.createTask.bind(this.taskService), [authInterceptor]),
                GetTasks: this.wrapHandlerWithInterceptor(this.taskService.getTasks.bind(this.taskService), [authInterceptor]),
                GetTask: this.wrapHandlerWithInterceptor(this.taskService.getTask.bind(this.taskService), [authInterceptor]),
                UpdateTask: this.wrapHandlerWithInterceptor(this.taskService.updateTask.bind(this.taskService), [authInterceptor]),
                DeleteTask: this.wrapHandlerWithInterceptor(this.taskService.deleteTask.bind(this.taskService), [authInterceptor]),
                GetTaskStats: this.wrapHandlerWithInterceptor(this.taskService.getTaskStats.bind(this.taskService), [authInterceptor]),
                StreamTasks: this.wrapHandlerWithInterceptor(this.taskService.streamTasks.bind(this.taskService), [authInterceptor]),
                StreamNotifications: this.wrapHandlerWithInterceptor(this.taskService.streamNotifications.bind(this.taskService), [authInterceptor])
            });

            // registrar ChatService (bidirectional streaming) com auth
            this.server.addService(chatProto.ChatService.service, {
                Chat: this.wrapHandlerWithInterceptor(this.chatService.chat.bind(this.chatService), [authInterceptor])
            });

            console.log('✅ Serviços gRPC registrados com sucesso');
        } catch (error) {
            console.error('❌ Erro na inicialização:', error);
            throw error;
        }
    }

    async start(port = 50051) {
        try {
            await this.initialize();

            const serverCredentials = grpc.ServerCredentials.createInsecure();
            
            this.server.bindAsync(`0.0.0.0:${port}`, serverCredentials, (error, boundPort) => {
                if (error) {
                    console.error('❌ Falha ao iniciar servidor:', error);
                    return;
                }

                this.server.start();
                console.log('🚀 =================================');
                console.log(`🚀 Servidor gRPC iniciado na porta ${boundPort}`);
                console.log(`🚀 Protocolo: gRPC/HTTP2`);
                console.log(`🚀 Serialização: Protocol Buffers`);
                console.log('🚀 Serviços disponíveis:');
                console.log('🚀   - AuthService (Register, Login, ValidateToken)');
                console.log('🚀   - TaskService (CRUD + Streaming)');
                console.log('🚀 =================================');
            });

            // Graceful shutdown
            process.on('SIGINT', () => {
                console.log('\n⏳ Encerrando servidor...');
                this.server.tryShutdown((error) => {
                    if (error) {
                        console.error('❌ Erro ao encerrar servidor:', error);
                        process.exit(1);
                    } else {
                        console.log('✅ Servidor encerrado com sucesso');
                        process.exit(0);
                    }
                });
            });

        } catch (error) {
            console.error('❌ Falha na inicialização do servidor:', error);
            process.exit(1);
        }
    }
}

// Inicialização
if (require.main === module) {
    const server = new GrpcServer();
    const port = process.env.GRPC_PORT || 50051;
    server.start(port);
}

module.exports = GrpcServer;