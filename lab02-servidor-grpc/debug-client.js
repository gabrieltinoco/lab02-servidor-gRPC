const GrpcClient = require('./client');

class DebugGrpcClient extends GrpcClient {
    constructor(serverAddress) {
        super(serverAddress);
        this.enableLogging = true;
        this.requestCounter = 0;
        this.performanceMetrics = {
            calls: [],
            totalRequests: 0,
            totalErrors: 0,
            avgResponseTime: 0
        };
    }

    log(message, data = null) {
        if (this.enableLogging) {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] ${message}`);
            if (data) {
                console.log(JSON.stringify(data, null, 2));
            }
        }
    }

    recordMetrics(method, duration, success) {
        this.performanceMetrics.totalRequests++;
        if (!success) this.performanceMetrics.totalErrors++;
        
        this.performanceMetrics.calls.push({
            method,
            duration,
            success,
            timestamp: Date.now()
        });

        // Calcular tempo médio de resposta
        const totalTime = this.performanceMetrics.calls.reduce((sum, call) => sum + call.duration, 0);
        this.performanceMetrics.avgResponseTime = totalTime / this.performanceMetrics.calls.length;
    }

    promisify(client, method) {
        return (request) => {
            return new Promise((resolve, reject) => {
                const requestId = ++this.requestCounter;
                this.log(`📤 [${requestId}] Calling ${method}`, request);
                const start = Date.now();
                
                client[method](request, (error, response) => {
                    const duration = Date.now() - start;
                    
                    if (error) {
                        this.log(`❌ [${requestId}] ${method} failed (${duration}ms)`, {
                            code: error.code,
                            message: error.message,
                            details: error.details
                        });
                        this.recordMetrics(method, duration, false);
                        reject(error);
                    } else {
                        this.log(`✅ [${requestId}] ${method} success (${duration}ms)`, response);
                        this.recordMetrics(method, duration, true);
                        resolve(response);
                    }
                });
            });
        };
    }

    streamTasks(filters = {}) {
        this.log('📤 Starting StreamTasks', filters);
        const stream = super.streamTasks(filters);
        let taskCount = 0;
        const startTime = Date.now();

        stream.on('data', (task) => {
            taskCount++;
            this.log(`📋 Stream task #${taskCount}`, {
                id: task.id,
                title: task.title,
                completed: task.completed,
                priority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'][task.priority]
            });
        });

        stream.on('end', () => {
            const duration = Date.now() - startTime;
            this.log(`📋 StreamTasks ended. Total: ${taskCount} tasks in ${duration}ms`);
        });

        stream.on('error', (error) => {
            this.log('❌ StreamTasks error', {
                code: error.code,
                message: error.message
            });
        });

        return stream;
    }

    streamNotifications() {
        this.log('📤 Starting StreamNotifications');
        const stream = super.streamNotifications();
        let notificationCount = 0;

        stream.on('data', (notification) => {
            notificationCount++;
            const typeMap = ['CREATED', 'UPDATED', 'DELETED', 'COMPLETED'];
            this.log(`🔔 Notification #${notificationCount}`, {
                type: typeMap[notification.type],
                message: notification.message,
                task: notification.task ? notification.task.title : null,
                timestamp: new Date(parseInt(notification.timestamp) * 1000).toISOString()
            });
        });

        stream.on('end', () => {
            this.log(`🔔 StreamNotifications ended. Total: ${notificationCount} notifications`);
        });

        stream.on('error', (error) => {
            this.log('❌ StreamNotifications error', {
                code: error.code,
                message: error.message
            });
        });

        return stream;
    }

    printMetrics() {
        console.log('\n📊 MÉTRICAS DE PERFORMANCE DO CLIENTE');
        console.log('='.repeat(50));
        console.log(`Total de requisições: ${this.performanceMetrics.totalRequests}`);
        console.log(`Total de erros: ${this.performanceMetrics.totalErrors}`);
        console.log(`Taxa de sucesso: ${((this.performanceMetrics.totalRequests - this.performanceMetrics.totalErrors) / this.performanceMetrics.totalRequests * 100).toFixed(2)}%`);
        console.log(`Tempo médio de resposta: ${this.performanceMetrics.avgResponseTime.toFixed(2)}ms`);
        
        if (this.performanceMetrics.calls.length > 0) {
            const methodStats = this.performanceMetrics.calls.reduce((acc, call) => {
                if (!acc[call.method]) {
                    acc[call.method] = { count: 0, totalTime: 0, errors: 0 };
                }
                acc[call.method].count++;
                acc[call.method].totalTime += call.duration;
                if (!call.success) acc[call.method].errors++;
                return acc;
            }, {});

            console.log('\n📈 Estatísticas por método:');
            Object.entries(methodStats).forEach(([method, stats]) => {
                const avgTime = stats.totalTime / stats.count;
                const successRate = ((stats.count - stats.errors) / stats.count * 100);
            Object.entries(methodStats).forEach(([method, stats]) => {
                const avgTime = stats.totalTime / stats.count;
                const successRate = ((stats.count - stats.errors) / stats.count * 100);
                console.log(`  ${method}: ${stats.count} calls, ${avgTime.toFixed(2)}ms avg, ${successRate.toFixed(1)}% success`);
            });
        }
    }
}

// Script de debug interativo
async function runDebugSession() {
    const client = new DebugGrpcClient('localhost:50051');
    
    try {
        await client.initialize();
        
        console.log('🔧 SESSÃO DE DEBUG gRPC INICIADA');
        console.log('=====================================\n');
        
        // Teste completo do ciclo de vida
        const email = `debug${Date.now()}@test.com`;
        
        // 1. Registro
        const regResponse = await client.register({
            email: email,
            username: `debug${Date.now()}`,
            password: 'debug123',
            first_name: 'Debug',
            last_name: 'User'
        });
        
        // 2. Login
        const loginResponse = await client.login({
            identifier: email,
            password: 'debug123'
        });
        
        // 3. Criar tarefas de teste
        const taskIds = [];
        for (let i = 1; i <= 3; i++) {
            const taskResponse = await client.createTask({
                title: `Debug Task ${i}`,
                description: `Task created for debugging purposes - ${i}`,
                priority: i % 4
            });
            taskIds.push(taskResponse.task.id);
        }
        
        // 4. Listar tarefas
        await client.getTasks({ page: 1, limit: 10 });
        
        // 5. Atualizar uma tarefa
        if (taskIds.length > 0) {
            await client.updateTask(taskIds[0], {
                title: 'Updated Debug Task',
                completed: true
            });
        }
        
        // 6. Buscar estatísticas
        await client.getStats();
        
        // 7. Teste de stream (breve)
        console.log('\n🌊 Testando streaming...');
        const stream = client.streamTasks();
        setTimeout(() => stream.cancel(), 2000);
        
        await new Promise(resolve => setTimeout(resolve, 2500));
        
        // 8. Limpeza - deletar tarefas criadas
        for (const taskId of taskIds) {
            await client.deleteTask(taskId);
        }
        
        // Imprimir métricas finais
        client.printMetrics();
        
    } catch (error) {
        console.error('❌ Erro na sessão de debug:', error);
    }
}

if (require.main === module) {
    runDebugSession();
}

module.exports = DebugGrpcClient;