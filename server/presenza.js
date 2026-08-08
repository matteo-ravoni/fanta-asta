// Traccia quali partecipanti hanno almeno un socket aperto in questo momento.
// Stato di processo, non persistito: alla riconnessione i client si ri-identificano.
const socketPerPartecipante = new Map();

function connetti(partecipanteId, socketId) {
    if (!socketPerPartecipante.has(partecipanteId)) {
        socketPerPartecipante.set(partecipanteId, new Set());
    }
    socketPerPartecipante.get(partecipanteId).add(socketId);
}

function disconnetti(partecipanteId, socketId) {
    const set = socketPerPartecipante.get(partecipanteId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) socketPerPartecipante.delete(partecipanteId);
}

function isConnesso(partecipanteId) {
    return socketPerPartecipante.has(partecipanteId);
}

module.exports = { connetti, disconnetti, isConnesso };
