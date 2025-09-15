// services/ChatService.js
const { v4: uuidv4 } = require('uuid');

class ChatService {
    constructor() {
        // Map sessionId -> { call, userId, username }
        this.sessions = new Map();
    }

    /**
     * chat(call) - bidirectional stream
     * - Recebe messages do cliente via call.on('data')
     * - Re-envia para todos os participantes (broadcast simples)
     */
    chat(call) {
        const sessionId = uuidv4();
        // tentar ler call.user (injetado pelo interceptor)
        const user = call.user || { id: 'anonymous', username: 'anon' };

        this.sessions.set(sessionId, { call, userId: user.id, username: user.username });

        console.log(`Chat session opened: ${sessionId} (${user.id})`);

        call.on('data', (msg) => {
            try {
                // Normalizar mensagem
                const message = {
                    id: msg.id || uuidv4(),
                    user_id: user.id,
                    username: user.username || msg.username || 'unknown',
                    text: msg.text,
                    timestamp: msg.timestamp || Math.floor(Date.now() / 1000)
                };

                // Broadcast para todas sessions (menos o remetente opcionalmente)
                for (const [sid, sess] of this.sessions.entries()) {
                    try {
                        // opcional: não reenviar ao próprio remetente
                        // if (sid === sessionId) continue;
                        sess.call.write(message);
                    } catch (e) {
                        console.error(`Erro ao enviar mensagem para session ${sid}:`, e.message);
                        try { sess.call.destroy(); } catch (ignored) {}
                        this.sessions.delete(sid);
                    }
                }
            } catch (e) {
                console.error('Erro no processamento de mensagem de chat:', e);
            }
        });

        call.on('end', () => {
            console.log(`Chat session closed (end): ${sessionId}`);
            this.sessions.delete(sessionId);
            try { call.end(); } catch (e) {}
        });

        call.on('cancelled', () => {
            console.log(`Chat session cancelled: ${sessionId}`);
            this.sessions.delete(sessionId);
        });

        call.on('error', (err) => {
            console.error(`Chat stream error (${sessionId}):`, err.message || err);
            this.sessions.delete(sessionId);
        });
    }
}

module.exports = ChatService;
