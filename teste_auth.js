const GrpcClient = require('./client');
const grpc = require('@grpc/grpc-js');

async function runAuthTests() {
    console.log('--- Iniciando Testes de Autenticação e Erros ---');
    const client = new GrpcClient('localhost:50051');
    await client.initialize();

    // Teste 1: Acesso protegido SEM token
    console.log('\n[TESTE 1] Tentando buscar tarefas sem token...');
    try {
        await client.getTasks();
    } catch (error) {
        if (error.code === grpc.status.UNAUTHENTICATED) {
            console.log('✅ SUCESSO: Recebido erro UNAUTHENTICATED (16) como esperado.');
        } else {
            console.error('❌ FALHA: Erro inesperado:', error);
        }
    }

    // Teste 2: Acesso protegido com token INVÁLIDO
    console.log('\n[TESTE 2] Tentando buscar tarefas com token inválido...');
    try {
        client.setToken('um.token.falso');
        await client.getTasks();
    } catch (error) {
        if (error.code === grpc.status.UNAUTHENTICATED) {
            console.log('✅ SUCESSO: Recebido erro UNAUTHENTICATED (16) como esperado.');
        } else {
            console.error('❌ FALHA: Erro inesperado:', error);
        }
    }
    client.setToken(null); // Limpar token

    // Teste 3: Registro e Login (endpoints públicos)
    console.log('\n[TESTE 3] Registrando e fazendo login...');
    const email = `auth-test-${Date.now()}@test.com`;
    await client.register({ email, username: `auth-test-${Date.now()}`, password: '123', first_name: 'T', last_name: 'S' });
    const loginRes = await client.login({ identifier: email, password: '123' });
    if (loginRes.success && client.currentToken) {
        console.log('✅ SUCESSO: Login bem-sucedido, token obtido.');
    } else {
        console.error('❌ FALHA: Login falhou.');
        return;
    }

    // Teste 4: Acesso protegido com token VÁLIDO
    console.log('\n[TESTE 4] Tentando buscar tarefas com token válido...');
    try {
        const tasksRes = await client.getTasks();
        if (tasksRes.success) {
            console.log('✅ SUCESSO: Tarefas listadas com sucesso.');
        }
    } catch (error) {
        console.error('❌ FALHA: Erro inesperado com token válido:', error);
    }

    // Teste 5: Erro NOT_FOUND
    console.log('\n[TESTE 5] Buscando tarefa com ID inexistente...');
    try {
        await client.getTask('id-que-nao-existe');
    } catch (error) {
        if (error.code === grpc.status.NOT_FOUND) {
             console.log('✅ SUCESSO: Recebido erro NOT_FOUND (5) como esperado.');
        } else {
            console.error('❌ FALHA: Erro inesperado:', error);
        }
    }
    console.log('\n--- Testes de Autenticação e Erros Concluídos ---');
}

runAuthTests();