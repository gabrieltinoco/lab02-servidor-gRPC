const grpc = require('@grpc/grpc-js');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const database = require('../database/database');
const jwt = require('jsonwebtoken');

class AuthService {
    /**
     * Registro de usuário
     * 
     * Implementa validação de dados e criação de usuário
     * usando Protocol Buffers para comunicação tipada
     */
    async register(call, callback) {
        try {
            const { email, username, password, first_name, last_name } = call.request;

            // Validações básicas
            if (!email || !username || !password || !first_name || !last_name) {
                return callback(null, {
                    success: false,
                    message: 'Todos os campos são obrigatórios',
                    errors: ['Campos obrigatórios não preenchidos']
                });
            }

            // Verificar se usuário já existe
            const existingUser = await database.get(
                'SELECT * FROM users WHERE email = ? OR username = ?',
                [email, username]
            );

            if (existingUser) {
                return callback(null, {
                    success: false,
                    message: 'Email ou username já existe',
                    errors: ['Usuário já cadastrado']
                });
            }

            // Criar usuário
            const userData = { 
                id: uuidv4(), 
                email, 
                username, 
                password, 
                firstName: first_name, 
                lastName: last_name 
            };
            const user = new User(userData);
            await user.hashPassword();

            await database.run(
                'INSERT INTO users (id, email, username, password, firstName, lastName) VALUES (?, ?, ?, ?, ?, ?)',
                [user.id, user.email, user.username, user.password, user.firstName, user.lastName]
            );

            const token = user.generateToken();

            callback(null, {
                success: true,
                message: 'Usuário criado com sucesso',
                user: user.toProtobuf(),
                token: token
            });
        } catch (error) {
            console.error('Erro no registro:', error);
            callback(null, {
                success: false,
                message: 'Erro interno do servidor',
                errors: ['Falha no processamento']
            });
        }
    }

    /**
     * Login de usuário
     */
    async login(call, callback) {
        try {
            const { identifier, password } = call.request;

            if (!identifier || !password) {
                return callback(null, {
                    success: false,
                    message: 'Credenciais obrigatórias',
                    errors: ['Email/username e senha são obrigatórios']
                });
            }

            const userData = await database.get(
                'SELECT * FROM users WHERE email = ? OR username = ?',
                [identifier, identifier]
            );

            if (!userData) {
                return callback(null, {
                    success: false,
                    message: 'Credenciais inválidas',
                    errors: ['Usuário não encontrado']
                });
            }

            const user = new User(userData);
            const isValidPassword = await user.comparePassword(password);

            if (!isValidPassword) {
                return callback(null, {
                    success: false,
                    message: 'Credenciais inválidas',
                    errors: ['Senha incorreta']
                });
            }

            const token = user.generateToken();

            callback(null, {
                success: true,
                message: 'Login realizado com sucesso',
                user: user.toProtobuf(),
                token: token
            });
        } catch (error) {
            console.error('Erro no login:', error);
            callback(null, {
                success: false,
                message: 'Erro interno do servidor',
                errors: ['Falha no processamento']
            });
        }
    }

    /**
     * Validação de token
     */
    async validateToken(call, callback) {
        try {
            const { token } = call.request;
            const jwtSecret = process.env.JWT_SECRET || 'seu-secret-aqui';

            if (!token) {
                return callback(null, {
                    valid: false,
                    message: 'Token não fornecido'
                });
            }

            const decoded = jwt.verify(token, jwtSecret);
            
            // Buscar dados atualizados do usuário
            const userData = await database.get('SELECT * FROM users WHERE id = ?', [decoded.id]);
            
            if (!userData) {
                return callback(null, {
                    valid: false,
                    message: 'Usuário não encontrado'
                });
            }

            const user = new User(userData);

            callback(null, {
                valid: true,
                user: user.toProtobuf(),
                message: 'Token válido'
            });
        } catch (error) {
            callback(null, {
                valid: false,
                message: 'Token inválido'
            });
        }
    }
}

module.exports = AuthService;