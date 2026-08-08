const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { getDb } = require('./db');
const configRouter = require('./config');
const partecipantiRouter = require('./partecipanti');
const auctionRouter = require('./auction');
const adminRouter = require('./admin');
const exportRouter = require('./export');
const presenza = require('./presenza');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
const server = http.createServer(app);
// pingInterval + pingTimeout ~= 5s: solo per l'indicatore "connesso/in attesa" nella pagina di
// collegamento. Non mette mai in pausa l'asta: bloccare lo schermo del telefono fa perdere la
// connessione quasi subito, e mettere l'asta in pausa ad ogni blocco schermo sarebbe fastidioso
// per tutti gli altri partecipanti.
const io = new Server(server, { pingInterval: 2000, pingTimeout: 3000 });

app.use(express.json());

app.get('/api/health', (req, res) => {
    const db = getDb();
    const { count } = db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'").get();
    res.json({ ok: true, tabelle: count, client_connessi: io.engine.clientsCount });
});

app.use('/api', configRouter.creaRouter(getDb));
app.use('/api', partecipantiRouter.creaRouter(getDb, io));
app.use('/api', auctionRouter.creaRouter(getDb, io));
app.use('/api', adminRouter.creaRouter(getDb, io));
app.use('/api', exportRouter.creaRouter(getDb, io));

app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

io.on('connection', (socket) => {
    console.log(`Client connesso: ${socket.id} (totale: ${io.engine.clientsCount})`);
    io.emit('partecipanti:online', io.engine.clientsCount);

    let partecipanteIdCollegato = null;

    socket.on('identifica', ({ token } = {}) => {
        const db = getDb();
        const p = db.prepare('SELECT id FROM partecipanti WHERE token = ?').get(token);
        if (!p) {
            socket.emit('identifica:errore', { messaggio: 'Sessione non valida.' });
            return;
        }
        partecipanteIdCollegato = p.id;
        presenza.connetti(p.id, socket.id);
        io.emit('partecipanti:aggiornati');
    });

    // Sincronizzazione oraria: i client sono spesso su rete WiFi isolata senza internet,
    // quindi senza NTP. Il countdown va confrontato con l'ora del server, non con l'orologio
    // (potenzialmente disallineato) del dispositivo.
    socket.on('ping-tempo', (_datiClient, callback) => {
        if (typeof callback === 'function') callback(Date.now());
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnesso: ${socket.id} (totale: ${io.engine.clientsCount})`);
        io.emit('partecipanti:online', io.engine.clientsCount);

        if (partecipanteIdCollegato !== null) {
            presenza.disconnetti(partecipanteIdCollegato, socket.id);
            io.emit('partecipanti:aggiornati');
        }
    });
});

getDb();
server.listen(PORT, () => {
    console.log(`Fantalega in ascolto su http://localhost:${PORT}`);
});
