// middleware/auth.js
const grpc = require('@grpc/grpc-js');
const jwt = require('jsonwebtoken');
const config = { jwtSecret: process.env.JWT_SECRET || 'seu-secret-aqui' };

/**
 * Valida token a partir de Metadata (Authorization: Bearer <token>)
 * Retorna objeto decodificado ou lança erro com propriedade .code (grpc.status)
 */
function authenticateMetadata(metadata) {
    const auth = metadata.get('authorization')[0] || metadata.get('Authorization')[0];
    if (!auth) {
        const err = new Error('Token de autenticação obrigatório');
        err.code = grpc.status.UNAUTHENTICATED;
        throw err;
    }

    const parts = auth.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        const err = new Error('Formato de token inválido');
        err.code = grpc.status.UNAUTHENTICATED;
        throw err;
    }

    const token = parts[1];

    try {
        const decoded = jwt.verify(token, config.jwtSecret);
        return decoded;
    } catch (error) {
        const err = new Error('Token inválido ou expirado');
        err.code = grpc.status.UNAUTHENTICATED;
        throw err;
    }
}

/**
 * Server interceptor: valida metadata antes do handler.
 * Uso: pasar para server via wrapper (exemplificado no server.js).
 */
function serverAuthInterceptor(options = {}) {
    const { skipMethods = [] } = options;
    return async (call, methodDescriptor, next) => {
        // método unary / streaming server: obter fullMethodName
        const methodName = methodDescriptor.path || methodDescriptor.originalName || methodDescriptor.name;

        // permitir saltar métodos públicos (ex: /auth.AuthService/Register)
        if (skipMethods.includes(methodName)) {
            return next(call);
        }

        try {
            const metadata = call.metadata || (call.getMetadata && call.getMetadata()) || call.request?.metadata;
            const user = authenticateMetadata(metadata);
            // injetar user no call (services podem ler call.user)
            call.user = user;
            return next(call);
        } catch (error) {
            // transformar para gRPC Error
            const grpcErr = new Error(error.message || 'Unauthenticated');
            grpcErr.code = error.code || grpc.status.UNAUTHENTICATED;
            // para chamadas unary/server-stream devemos terminar com error
            // se for streaming bidi, next(call) poderá lidar. Aqui rejeitamos.
            // Se call.callback existir (unary) chamamos via callback; caso contrário destruímos a call.
            if (call.callback) {
                return call.callback(grpcErr);
            } else if (call.emit) {
                // For streaming server, destroy
                try { call.destroy(grpcErr); } catch (e) {}
            }
        }
    };
}

module.exports = { authenticateMetadata, serverAuthInterceptor };
