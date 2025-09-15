const jwt = require('jsonwebtoken');
const config = { jwtSecret: process.env.JWT_SECRET || 'seu-secret-aqui' };

/**
 * Interceptor de Autenticação gRPC
 * 
 * No gRPC, interceptors funcionam como middleware,
 * permitindo processamento cross-cutting como autenticação
 */

class AuthInterceptor {
    static validateToken(call, callback, next) {
        const token = call.request.token;
        
        if (!token) {
            const error = new Error('Token de autenticação obrigatório');
            error.code = grpc.status.UNAUTHENTICATED;
            return callback(error);
        }

        try {
            const decoded = jwt.verify(token, config.jwtSecret);
            call.user = decoded;
            
            if (next) {
                return next(call, callback);
            }
        } catch (error) {
            const grpcError = new Error('Token inválido');
            grpcError.code = grpc.status.UNAUTHENTICATED;
            return callback(grpcError);
        }
    }

    static createInterceptor() {
        return (options, nextCall) => {
            return new grpc.InterceptingCall(nextCall(options), {
                start: function(metadata, listener, next) {
                    // Interceptar metadados se necessário
                    next(metadata, listener);
                }
            });
        };
    }
}

module.exports = AuthInterceptor;