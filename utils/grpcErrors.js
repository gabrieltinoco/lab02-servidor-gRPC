// utils/grpcErrors.js
const grpc = require('@grpc/grpc-js');

function toGrpcError(error) {
    // se já tem code, respeitar
    const grpcErr = new Error(error.message || 'Erro interno');
    grpcErr.code = error.code || mapErrorToStatus(error);
    return grpcErr;
}

function mapErrorToStatus(error) {
    // heurísticas simples
    if (!error) return grpc.status.INTERNAL;
    const msg = (error.message || '').toLowerCase();

    if (msg.includes('token') || msg.includes('autentic')) return grpc.status.UNAUTHENTICATED;
    if (msg.includes('não encontrado') || msg.includes('not found')) return grpc.status.NOT_FOUND;
    if (msg.includes('titulo') || msg.includes('obrigat') || msg.includes('invalid')) return grpc.status.INVALID_ARGUMENT;
    // default
    return grpc.status.INTERNAL;
}

module.exports = { toGrpcError, mapErrorToStatus };
