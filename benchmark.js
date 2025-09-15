const axios = require('axios'); // Para REST
const GrpcClient = require('./client'); // Para gRPC

/**
 * Benchmark: gRPC vs REST - VERSÃO CORRIGIDA
 * 
 * Compara performance entre implementações
 * gRPC/Protobuf vs REST/JSON
 */

class PerformanceBenchmark {
    constructor() {
        this.results = {
            grpc: { times: [], errors: 0, totalBytes: 0 },
            rest: { times: [], errors: 0, totalBytes: 0 }
        };
    }

    async setupGrpcUser() {
        const client = new GrpcClient();
        await client.initialize();
        
        const uniqueId = Date.now();
        const userData = {
            email: `benchmark${uniqueId}@grpc.com`,
            username: `benchmarkuser${uniqueId}`,
            password: 'benchmark123',
            first_name: 'Benchmark',
            last_name: 'User'
        };

        console.log('🔧 Configurando usuário para benchmark gRPC...');
        
        try {
            // Tentar registrar usuário
            const regResponse = await client.register(userData);
            if (regResponse.success && regResponse.token) {
                console.log('✅ Usuário registrado com sucesso');
                client.currentToken = regResponse.token;
                return client;
            } else {
                console.log('⚠️ Falha no registro, tentando login...');
                throw new Error('Registro falhou');
            }
        } catch (regError) {
            // Se registro falhar, tentar login
            try {
                const loginResponse = await client.login({
                    identifier: userData.email,
                    password: userData.password
                });
                
                if (loginResponse.success && loginResponse.token) {
                    console.log('✅ Login realizado com sucesso');
                    client.currentToken = loginResponse.token;
                    return client;
                } else {
                    throw new Error('Login também falhou');
                }
            } catch (loginError) {
                console.log('❌ Erro na autenticação gRPC:', loginError.message);
                throw new Error(`Falha na autenticação: ${loginError.message}`);
            }
        }
    }

    async benchmarkGrpc(iterations = 100) {
        console.log(`🔬 Iniciando benchmark gRPC (${iterations} iterações)...`);
        
        let client;
        try {
            client = await this.setupGrpcUser();
            
            // Verificar se o token está funcionando
            try {
                await client.getTasks({ page: 1, limit: 1 });
                console.log('✅ Token gRPC validado');
            } catch (error) {
                console.log('❌ Token inválido, tentando reautenticar...');
                client = await this.setupGrpcUser();
            }
            
        } catch (error) {
            console.log('❌ Falha na configuração do cliente gRPC:', error.message);
            console.log('⚠️ Pulando benchmark gRPC');
            return;
        }

        // Criar algumas tarefas para teste se não existirem
        console.log('📋 Criando tarefas de teste...');
        for (let i = 0; i < 3; i++) {
            try {
                await client.createTask({
                    title: `Tarefa Benchmark gRPC ${i + 1}`,
                    description: `Descrição da tarefa ${i + 1} para teste de performance`,
                    priority: i % 4 // Varia entre 0-3
                });
            } catch (error) {
                // Se falhar na criação, não é crítico
                console.log(`⚠️ Falha ao criar tarefa ${i + 1}: ${error.message}`);
            }
        }

        console.log('📊 Executando testes de performance gRPC...');

        // Benchmark de listagem de tarefas
        let successCount = 0;
        for (let i = 0; i < iterations; i++) {
            const start = process.hrtime.bigint();
            
            try {
                const response = await client.getTasks({ page: 1, limit: 10 });
                const end = process.hrtime.bigint();
                const duration = Number(end - start) / 1e6; // Convert to milliseconds
                
                this.results.grpc.times.push(duration);
                successCount++;
                
                // Estimar tamanho da resposta
                const responseSize = JSON.stringify(response).length;
                this.results.grpc.totalBytes += responseSize;
                
                if (i % 20 === 0 && i > 0) {
                    console.log(`gRPC: ${i}/${iterations} completed (${successCount} success)`);
                }
            } catch (error) {
                this.results.grpc.errors++;
                console.error(`❌ Erro gRPC na iteração ${i}: ${error.message}`);
                
                // Se muitos erros consecutivos, parar
                if (this.results.grpc.errors > 10 && i < 20) {
                    console.log('❌ Muitos erros gRPC, interrompendo benchmark');
                    break;
                }
            }
        }

        console.log(`✅ Benchmark gRPC concluído: ${successCount}/${iterations} sucessos`);
    }

    async setupRestUser() {
        const baseUrl = 'http://localhost:3000/api';
        const uniqueId = Date.now() + 1000; // Diferente do gRPC
        
        const userData = {
            email: `benchmarkrest${uniqueId}@rest.com`,
            username: `benchmarkrest${uniqueId}`,
            password: 'benchmark123',
            firstName: 'Benchmark',
            lastName: 'REST'
        };

        console.log('🔧 Configurando usuário para benchmark REST...');

        try {
            // Tentar registrar
            try {
                await axios.post(`${baseUrl}/auth/register`, userData);
                console.log('✅ Usuário REST registrado');
            } catch (regError) {
                console.log('⚠️ Registro REST falhou (usuário pode já existir)');
            }

            // Fazer login
            const loginResponse = await axios.post(`${baseUrl}/auth/login`, {
                identifier: userData.email,
                password: userData.password
            });

            const token = loginResponse.data.data.token;
            console.log('✅ Login REST realizado com sucesso');
            
            return { token, baseUrl };
            
        } catch (error) {
            throw new Error(`Falha na autenticação REST: ${error.message}`);
        }
    }

    async benchmarkRest(iterations = 100) {
        console.log(`🌐 Iniciando benchmark REST (${iterations} iterações)...`);
        
        let restConfig;
        try {
            restConfig = await this.setupRestUser();
        } catch (error) {
            console.log('⚠️ Servidor REST não disponível ou erro na configuração:', error.message);
            console.log('   Para executar comparação completa, inicie o servidor do Roteiro 1 na porta 3000');
            return;
        }

        const { token, baseUrl } = restConfig;
        const headers = { Authorization: `Bearer ${token}` };

        // Criar algumas tarefas para teste
        console.log('📋 Criando tarefas de teste REST...');
        for (let i = 0; i < 3; i++) {
            try {
                await axios.post(`${baseUrl}/tasks`, {
                    title: `Tarefa REST Benchmark ${i + 1}`,
                    description: `Descrição da tarefa ${i + 1} para teste de performance`,
                    priority: ['low', 'medium', 'high', 'urgent'][i % 4]
                }, { headers });
            } catch (error) {
                console.log(`⚠️ Falha ao criar tarefa REST ${i + 1}: ${error.message}`);
            }
        }

        console.log('📊 Executando testes de performance REST...');

        // Benchmark de listagem de tarefas
        let successCount = 0;
        for (let i = 0; i < iterations; i++) {
            const start = process.hrtime.bigint();
            
            try {
                const response = await axios.get(`${baseUrl}/tasks?page=1&limit=10`, { headers });
                const end = process.hrtime.bigint();
                const duration = Number(end - start) / 1e6;
                
                this.results.rest.times.push(duration);
                successCount++;
                
                // Calcular tamanho real da resposta
                const responseSize = JSON.stringify(response.data).length;
                this.results.rest.totalBytes += responseSize;
                
                if (i % 20 === 0 && i > 0) {
                    console.log(`REST: ${i}/${iterations} completed (${successCount} success)`);
                }
            } catch (error) {
                this.results.rest.errors++;
                console.error(`❌ Erro REST na iteração ${i}: ${error.message}`);
                
                // Se muitos erros consecutivos, parar
                if (this.results.rest.errors > 10 && i < 20) {
                    console.log('❌ Muitos erros REST, interrompendo benchmark');
                    break;
                }
            }
        }

        console.log(`✅ Benchmark REST concluído: ${successCount}/${iterations} sucessos`);
    }

    calculateStats(times) {
        if (times.length === 0) return null;
        
        const sorted = times.sort((a, b) => a - b);
        const sum = times.reduce((acc, time) => acc + time, 0);
        
        return {
            mean: sum / times.length,
            median: sorted[Math.floor(sorted.length / 2)],
            min: sorted[0],
            max: sorted[sorted.length - 1],
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)],
            stdDev: Math.sqrt(times.reduce((acc, time) => acc + Math.pow(time - (sum / times.length), 2), 0) / times.length)
        };
    }

    printResults() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 RESULTADOS DO BENCHMARK DE PERFORMANCE');
        console.log('='.repeat(60));

        const grpcStats = this.calculateStats(this.results.grpc.times);
        const restStats = this.calculateStats(this.results.rest.times);

        if (grpcStats && this.results.grpc.times.length > 0) {
            console.log('\n🔧 gRPC/Protocol Buffers:');
            console.log(`   ├─ Requisições válidas: ${this.results.grpc.times.length}`);
            console.log(`   ├─ Erros: ${this.results.grpc.errors}`);
            console.log(`   ├─ Taxa de sucesso: ${((this.results.grpc.times.length / (this.results.grpc.times.length + this.results.grpc.errors)) * 100).toFixed(1)}%`);
            console.log(`   ├─ Tempo médio: ${grpcStats.mean.toFixed(2)}ms`);
            console.log(`   ├─ Mediana: ${grpcStats.median.toFixed(2)}ms`);
            console.log(`   ├─ Desvio padrão: ${grpcStats.stdDev.toFixed(2)}ms`);
            console.log(`   ├─ Min/Max: ${grpcStats.min.toFixed(2)}ms / ${grpcStats.max.toFixed(2)}ms`);
            console.log(`   ├─ P95: ${grpcStats.p95.toFixed(2)}ms`);
            console.log(`   ├─ P99: ${grpcStats.p99.toFixed(2)}ms`);
            console.log(`   └─ Total bytes: ${this.results.grpc.totalBytes.toLocaleString()}`);
        } else {
            console.log('\n🔧 gRPC/Protocol Buffers:');
            console.log('   └─ ❌ Nenhum dado válido coletado');
        }

        if (restStats && this.results.rest.times.length > 0) {
            console.log('\n🌐 REST/JSON:');
            console.log(`   ├─ Requisições válidas: ${this.results.rest.times.length}`);
            console.log(`   ├─ Erros: ${this.results.rest.errors}`);
            console.log(`   ├─ Taxa de sucesso: ${((this.results.rest.times.length / (this.results.rest.times.length + this.results.rest.errors)) * 100).toFixed(1)}%`);
            console.log(`   ├─ Tempo médio: ${restStats.mean.toFixed(2)}ms`);
            console.log(`   ├─ Mediana: ${restStats.median.toFixed(2)}ms`);
            console.log(`   ├─ Desvio padrão: ${restStats.stdDev.toFixed(2)}ms`);
            console.log(`   ├─ Min/Max: ${restStats.min.toFixed(2)}ms / ${restStats.max.toFixed(2)}ms`);
            console.log(`   ├─ P95: ${restStats.p95.toFixed(2)}ms`);
            console.log(`   ├─ P99: ${restStats.p99.toFixed(2)}ms`);
            console.log(`   └─ Total bytes: ${this.results.rest.totalBytes.toLocaleString()}`);
        } else {
            console.log('\n🌐 REST/JSON:');
            console.log('   └─ ⚠️ Servidor REST não disponível ou sem dados válidos');
        }

        if (grpcStats && restStats && this.results.grpc.times.length > 0 && this.results.rest.times.length > 0) {
            const latencyImprovement = ((restStats.mean - grpcStats.mean) / restStats.mean * 100);
            const bandwidthSavings = ((this.results.rest.totalBytes - this.results.grpc.totalBytes) / this.results.rest.totalBytes * 100);
            
            console.log('\n🏆 ANÁLISE COMPARATIVA:');
            console.log(`   ├─ Latência: gRPC é ${Math.abs(latencyImprovement).toFixed(1)}% ${latencyImprovement > 0 ? 'mais rápido' : 'mais lento'} que REST`);
            console.log(`   ├─ Diferença média: ${Math.abs(restStats.mean - grpcStats.mean).toFixed(2)}ms`);
            console.log(`   ├─ Bandwidth: gRPC usa ${Math.abs(bandwidthSavings).toFixed(1)}% ${bandwidthSavings > 0 ? 'menos' : 'mais'} dados`);
            console.log(`   ├─ Throughput gRPC: ${(1000 / grpcStats.mean).toFixed(1)} req/s`);
            console.log(`   ├─ Throughput REST: ${(1000 / restStats.mean).toFixed(1)} req/s`);
            
            if (latencyImprovement > 0) {
                console.log(`   └─ 🎯 gRPC demonstra melhor performance para este caso de uso`);
            } else {
                console.log(`   └─ ⚠️ REST apresentou melhor performance neste teste`);
            }
        } else {
            console.log('\n🏆 ANÁLISE COMPARATIVA:');
            console.log('   └─ ⚠️ Comparação não disponível - dados insuficientes de um ou ambos protocolos');
        }

        console.log('\n📝 OBSERVAÇÕES:');
        console.log('   • Resultados podem variar baseado em hardware, rede e carga do sistema');
        console.log('   • gRPC típicamente performa melhor com payloads maiores e alta frequência');
        console.log('   • REST pode ser mais rápido para operações simples e cache HTTP');
        console.log('   • Considere também fatores como debugging, tooling e ecosystem');
        console.log('   • Para comparação completa, certifique-se que ambos servidores estão rodando');
    }
}

// Executar benchmark
async function runBenchmark() {
    const iterations = process.argv[2] ? parseInt(process.argv[2]) : 50;
    const benchmark = new PerformanceBenchmark();
    
    console.log(`🚀 Iniciando benchmark com ${iterations} iterações por protocolo`);
    console.log('⏱️ Este processo pode levar alguns minutos...\n');
    
    // Verificar se pelo menos um servidor está disponível
    console.log('🔍 Verificando disponibilidade dos servidores...');
    
    try {
        // Testar gRPC
        const grpcClient = new GrpcClient();
        await grpcClient.initialize();
        console.log('✅ Servidor gRPC disponível');
    } catch (error) {
        console.log('❌ Servidor gRPC não disponível:', error.message);
        console.log('   Execute "npm start" para iniciar o servidor gRPC');
        return;
    }
    
    try {
        // Testar REST
        await axios.get('http://localhost:3000/health');
        console.log('✅ Servidor REST disponível');
    } catch (error) {
        console.log('⚠️ Servidor REST não disponível (comparação limitada)');
        console.log('   Para comparação completa, execute o servidor do Roteiro 1 na porta 3000');
    }
    
    console.log(''); // Nova linha
    
    try {
        await benchmark.benchmarkGrpc(iterations);
        await benchmark.benchmarkRest(iterations);
        benchmark.printResults();
    } catch (error) {
        console.error('❌ Erro no benchmark:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

if (require.main === module) {
    runBenchmark().catch(error => {
        console.error('❌ Falha crítica no benchmark:', error.message);
        process.exit(1);
    });
}

module.exports = PerformanceBenchmark;