const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

/**
 * Carregador de Protocol Buffers
 * 
 * Segundo Tanenbaum & Van Steen (2017), a serialização de dados
 * é crucial para comunicação entre sistemas distribuídos.
 * Protocol Buffers oferece:
 * - Serialização binária eficiente
 * - Type safety
 * - Versionamento de esquemas
 */

class ProtoLoader {
    constructor() {
        this.packageDefinitions = new Map();
        this.services = new Map();
    }

    loadProto(protoFile, packageName) {
        const PROTO_PATH = path.join(__dirname, '../protos', protoFile);
        
        const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true
        });

        const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
        
        this.packageDefinitions.set(packageName, packageDefinition);
        this.services.set(packageName, protoDescriptor[packageName]);
        
        return protoDescriptor[packageName];
    }

    getService(packageName) {
        return this.services.get(packageName);
    }

    // Helpers para conversão de dados
    static convertTimestamp(date) {
        return Math.floor(new Date(date).getTime() / 1000);
    }

    static convertFromTimestamp(timestamp) {
        return new Date(parseInt(timestamp) * 1000);
    }

    static convertPriority(priority) {
        const priorityMap = {
            'low': 0,
            'medium': 1, 
            'high': 2,
            'urgent': 3
        };
        return priorityMap[priority] || 1;
    }

    static convertFromPriority(priorityValue) {
        const priorityMap = ['low', 'medium', 'high', 'urgent'];
        return priorityMap[priorityValue] || 'medium';
    }
}

module.exports = ProtoLoader;