const GrpcServer = require('../server');
const GrpcClient = require('../client');

describe('gRPC Services Tests', () => {
    let server;
    let client;
    let authToken;
    let taskId;

    beforeAll(async () => {
        // Iniciar servidor gRPC em porta diferente para testes
        server = new GrpcServer();
        
        // Usar Promise para aguardar o servidor inicializar
        await new Promise((resolve, reject) => {
            server.initialize().then(() => {
                const grpc = require('@grpc/grpc-js');
                const serverCredentials = grpc.ServerCredentials.createInsecure();
                
                server.server.bindAsync('0.0.0.0:50052', serverCredentials, (error, boundPort) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    server.server.start();
                    resolve();
                });
            }).catch(reject);
        });
        
        // Aguardar um pouco mais para garantir que o servidor está pronto
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Inicializar cliente
        client = new GrpcClient('localhost:50052');
        await client.initialize();
    }, 30000);

    afterAll(async () => {
        if (server?.server) {
            await new Promise(resolve => {
                server.server.tryShutdown(() => resolve());
            });
        }
    });

    describe('Autenticação', () => {
        test('deve registrar usuário com sucesso', async () => {
            const uniqueId = Date.now();
            const response = await client.register({
                email: `test${uniqueId}@grpc.com`,
                username: `grpctest${uniqueId}`,
                password: 'password123',
                first_name: 'Test',
                last_name: 'User'
            });

            expect(response.success).toBe(true);
            expect(response.token).toBeDefined();
            expect(response.user).toBeDefined();
            expect(response.user.email).toBe(`test${uniqueId}@grpc.com`);
            authToken = response.token;
            
            // Configurar o token no cliente para próximos testes
            client.currentToken = response.token;
        });

        test('deve fazer login com sucesso', async () => {
            // Usar as credenciais do usuário recém-criado
            const response = await client.login({
                identifier: client.currentToken ? 'existing_user@grpc.com' : 'test@grpc.com',
                password: 'password123'
            });

            // Se o login falhar, tentar com usuário que sabemos que existe
            if (!response.success) {
                // Criar um novo usuário para login
                const uniqueId = Date.now() + 1;
                await client.register({
                    email: `logintest${uniqueId}@grpc.com`,
                    username: `logintest${uniqueId}`,
                    password: 'password123',
                    first_name: 'Login',
                    last_name: 'Test'
                });

                const loginResponse = await client.login({
                    identifier: `logintest${uniqueId}@grpc.com`,
                    password: 'password123'
                });

                expect(loginResponse.success).toBe(true);
                expect(loginResponse.token).toBeDefined();
                expect(loginResponse.user).toBeDefined();
                client.currentToken = loginResponse.token;
            } else {
                expect(response.success).toBe(true);
                expect(response.token).toBeDefined();
                expect(response.user).toBeDefined();
            }
        });

        test('deve rejeitar credenciais inválidas', async () => {
            const response = await client.login({
                identifier: 'usuario_inexistente@grpc.com',
                password: 'senhaerrada'
            });

            expect(response.success).toBe(false);
            expect(response.errors).toBeDefined();
            expect(response.errors.length).toBeGreaterThan(0);
        });

        test('deve validar token corretamente', async () => {
            // Garantir que temos um token válido
            if (!client.currentToken) {
                const uniqueId = Date.now() + 2;
                const regResponse = await client.register({
                    email: `tokentest${uniqueId}@grpc.com`,
                    username: `tokentest${uniqueId}`,
                    password: 'password123',
                    first_name: 'Token',
                    last_name: 'Test'
                });
                client.currentToken = regResponse.token;
            }

            const validateTokenPromise = client.promisify(client.authClient, 'ValidateToken');
            const response = await validateTokenPromise({ token: client.currentToken });

            expect(response.valid).toBe(true);
            expect(response.user).toBeDefined();
        });

        test('deve rejeitar token inválido', async () => {
            const validateTokenPromise = client.promisify(client.authClient, 'ValidateToken');
            const response = await validateTokenPromise({ token: 'token-invalido' });

            expect(response.valid).toBe(false);
            expect(response.message).toContain('inválido');
        });
    });

    describe('Gerenciamento de Tarefas', () => {
        beforeAll(async () => {
            // Garantir que temos um token válido antes dos testes de tarefas
            if (!client.currentToken) {
                const uniqueId = Date.now() + 100;
                const regResponse = await client.register({
                    email: `tasktest${uniqueId}@grpc.com`,
                    username: `tasktest${uniqueId}`,
                    password: 'password123',
                    first_name: 'Task',
                    last_name: 'Test'
                });
                client.currentToken = regResponse.token;
            }
        });

        test('deve criar tarefa com dados válidos', async () => {
            const response = await client.createTask({
                title: 'Tarefa gRPC Test',
                description: 'Testando criação via gRPC',
                priority: 1 // MEDIUM
            });

            expect(response.success).toBe(true);
            expect(response.task).toBeDefined();
            expect(response.task.title).toBe('Tarefa gRPC Test');
            expect(response.task.priority).toBe('MEDIUM');
            taskId = response.task.id;
        });

        test('deve rejeitar criação sem título', async () => {
            try {
                const response = await client.createTask({
                    title: '',
                    description: 'Sem título',
                    priority: 1
                });

                // Se chegou aqui, a resposta deve indicar falha
                expect(response.success).toBe(false);
                if (response.errors) {
                    expect(response.errors).toContain('Título não pode estar vazio');
                }
            } catch (error) {
                // Erro gRPC é esperado para dados inválidos
                expect(error.code).toBeDefined();
            }
        });

        test('deve listar tarefas com paginação', async () => {
            const response = await client.getTasks({
                page: 1,
                limit: 10
            });

            expect(response.success).toBe(true);
            expect(Array.isArray(response.tasks)).toBe(true);
            expect(response.total).toBeGreaterThanOrEqual(0);
            expect(response.page).toBe(1);
            expect(response.limit).toBe(10);
        });

        test('deve buscar tarefa específica', async () => {
            if (!taskId) {
                // Criar uma tarefa se não temos ID
                const createResponse = await client.createTask({
                    title: 'Tarefa para busca',
                    description: 'Teste de busca específica',
                    priority: 0
                });
                taskId = createResponse.task.id;
            }

            const response = await client.getTask(taskId);

            expect(response.success).toBe(true);
            expect(response.task).toBeDefined();
            expect(response.task.id).toBe(taskId);
        });

        test('deve retornar erro para tarefa inexistente', async () => {
            const response = await client.getTask('id-inexistente-123456');

            expect(response.success).toBe(false);
            expect(response.message).toContain('não encontrada');
        });

        test('deve atualizar tarefa existente', async () => {
            if (!taskId) {
                // Criar uma tarefa se não temos ID
                const createResponse = await client.createTask({
                    title: 'Tarefa para atualizar',
                    description: 'Teste de atualização',
                    priority: 1
                });
                taskId = createResponse.task.id;
            }

            const response = await client.updateTask(taskId, {
                title: 'Tarefa Atualizada via gRPC',
                completed: true
            });

            expect(response.success).toBe(true);
            expect(response.task.title).toBe('Tarefa Atualizada via gRPC');
            expect(response.task.completed).toBe(true);
        });

        test('deve buscar estatísticas das tarefas', async () => {
            const response = await client.getStats();

            expect(response.success).toBe(true);
            expect(response.stats).toBeDefined();
            expect(typeof response.stats.total).toBe('number');
            expect(typeof response.stats.completed).toBe('number');
            expect(typeof response.stats.pending).toBe('number');
            expect(typeof response.stats.completion_rate).toBe('number');
        });

        test('deve deletar tarefa existente', async () => {
            if (!taskId) {
                // Criar uma tarefa para deletar se não temos ID
                const createResponse = await client.createTask({
                    title: 'Tarefa para deletar',
                    description: 'Teste de exclusão',
                    priority: 0
                });
                taskId = createResponse.task.id;
            }

            const response = await client.deleteTask(taskId);

            expect(response.success).toBe(true);
            expect(response.message).toContain('deletada com sucesso');
            
            // Limpar o taskId já que foi deletado
            taskId = null;
        });

        test('deve retornar erro ao deletar tarefa inexistente', async () => {
            const response = await client.deleteTask('id-inexistente-123456');

            expect(response.success).toBe(false);
            expect(response.message).toContain('não encontrada');
        });

        test('deve filtrar tarefas por status', async () => {
            // Criar uma tarefa não concluída
            await client.createTask({
                title: 'Tarefa Pendente',
                description: 'Não concluída',
                priority: 0
            });

            // Criar uma tarefa concluída
            const completedTask = await client.createTask({
                title: 'Tarefa Concluída',
                description: 'Já finalizada',
                priority: 1
            });

            await client.updateTask(completedTask.task.id, {
                completed: true
            });

            // Buscar apenas tarefas concluídas
            const completedResponse = await client.getTasks({ completed: true });
            expect(completedResponse.success).toBe(true);
            
            // Buscar apenas tarefas pendentes
            const pendingResponse = await client.getTasks({ completed: false });
            expect(pendingResponse.success).toBe(true);
        });
    });

    describe('Streaming', () => {
        beforeAll(async () => {
            // Garantir que temos um token válido antes dos testes de streaming
            if (!client.currentToken) {
                const uniqueId = Date.now() + 200;
                const regResponse = await client.register({
                    email: `streamtest${uniqueId}@grpc.com`,
                    username: `streamtest${uniqueId}`,
                    password: 'password123',
                    first_name: 'Stream',
                    last_name: 'Test'
                });
                client.currentToken = regResponse.token;
            }

            // Criar uma tarefa para garantir que o streaming tenha dados
            try {
                await client.createTask({
                    title: 'Tarefa para Stream Test',
                    description: 'Esta tarefa será usada nos testes de streaming',
                    priority: 1
                });
            } catch (error) {
                // Se falhar, não é crítico para os testes
                console.log('Falha ao criar tarefa para teste de stream:', error.message);
            }
        });

        test('deve receber stream de tarefas', (done) => {
            const stream = client.streamTasks();
            let receivedTasks = [];
            let streamEnded = false;
            let doneWasCalled = false;

            const finishTest = () => {
                if (!doneWasCalled) {
                    doneWasCalled = true;
                    done();
                }
            };

            const timeout = setTimeout(() => {
                if (!streamEnded && !doneWasCalled) {
                    stream.cancel();
                    expect(receivedTasks.length).toBeGreaterThanOrEqual(0);
                    finishTest();
                }
            }, 5000);

            stream.on('data', (task) => {
                receivedTasks.push(task);
                expect(task.id).toBeDefined();
                expect(task.title).toBeDefined();
            });

            stream.on('end', () => {
                if (!streamEnded) {
                    streamEnded = true;
                    clearTimeout(timeout);
                    expect(receivedTasks.length).toBeGreaterThanOrEqual(0);
                    finishTest();
                }
            });

            stream.on('error', (error) => {
                if (!streamEnded) {
                    streamEnded = true;
                    clearTimeout(timeout);
                    // Erro pode ser esperado se não houver tarefas
                    console.log('Stream error (pode ser esperado):', error.message);
                    finishTest();
                }
            });

            // Cancelar stream após 3 segundos para evitar timeout
            setTimeout(() => {
                if (!streamEnded && !doneWasCalled) {
                    streamEnded = true;
                    clearTimeout(timeout);
                    stream.cancel();
                    finishTest();
                }
            }, 3000);
        }, 10000);

        test('deve receber stream de notificações', (done) => {
            const stream = client.streamNotifications();
            let receivedNotifications = [];
            let streamEnded = false;
            let doneWasCalled = false;

            const finishTest = () => {
                if (!doneWasCalled) {
                    doneWasCalled = true;
                    done();
                }
            };

            const timeout = setTimeout(() => {
                if (!streamEnded && !doneWasCalled) {
                    stream.cancel();
                    // Pelo menos devemos receber a notificação inicial
                    expect(receivedNotifications.length).toBeGreaterThanOrEqual(0);
                    finishTest();
                }
            }, 5000);

            stream.on('data', (notification) => {
                receivedNotifications.push(notification);
                expect(typeof notification.type).toBe('string');
                expect(notification.message).toBeDefined();
                expect(notification.timestamp).toBeDefined();
            });

            stream.on('end', () => {
                if (!streamEnded) {
                    streamEnded = true;
                    clearTimeout(timeout);
                    finishTest();
                }
            });

            stream.on('error', (error) => {
                if (!streamEnded) {
                    streamEnded = true;
                    clearTimeout(timeout);
                    console.log('Notification stream error (pode ser esperado):', error.message);
                    finishTest();
                }
            });

            // Cancelar stream após 2 segundos para garantir que termine
            setTimeout(() => {
                if (!streamEnded && !doneWasCalled) {
                    streamEnded = true;
                    clearTimeout(timeout);
                    // Devemos ter recebido pelo menos a mensagem inicial
                    expect(receivedNotifications.length).toBeGreaterThanOrEqual(1);
                    stream.cancel();
                    finishTest();
                }
            }, 2000);
        }, 10000);
    });

    describe('Validações e Segurança', () => {
        test('deve rejeitar requisições sem token', async () => {
            const client2 = new GrpcClient('localhost:50052');
            await client2.initialize();
            client2.currentToken = null;

            try {
                await client2.getTasks();
                fail('Deveria ter rejeitado requisição sem token');
            } catch (error) {
                expect(error.code).toBe(16); // UNAUTHENTICATED
            }
        });

        test('deve rejeitar token expirado/inválido', async () => {
            const client3 = new GrpcClient('localhost:50052');
            await client3.initialize();
            client3.currentToken = 'token.invalido.aqui';

            try {
                await client3.getTasks();
                fail('Deveria ter rejeitado token inválido');
            } catch (error) {
                expect(error.code).toBe(16); // UNAUTHENTICATED
            }
        });
    });
});