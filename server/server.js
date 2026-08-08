const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { getDb } = require('./db');
const configRouter = require('./config');
const partecipantiRouter = require('./partecipanti');
const auctionRouter = require('./auction');
const presenza = require('./presenza');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

app.get('/api/health', (req, res) => {
    const db = getDb();
    const { count } = db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'").get();
    res.json({ ok: true, tabelle: count, client_connessi: io.engine.clientsCount });
});

app.use('/api', configRouter.creaRouter(getDb));
app.use('/api', partecipantiRouter.creaRouter(getDb, io));
app.use('/api', auctionRouter.creaRouter(getDb, io));

app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

io.on('connection', (socket) => {
    console.log(`Client connesso: ${socket.id} (totale: ${io.engine.clientsCount})`);
    io.emit('partecipanti:online', io.engine.clientsCount);

    let partecipanteIdCollegato = null;

    socket.on('identifica', ({ token } = {}) => {
        const p = getDb().prepare('SELECT id FROM partecipanti WHERE token = ?').get(token);
        if (!p) {
            socket.emit('identifica:errore', { messaggio: 'Sessione non valida.' });
            return;
        }
        partecipanteIdCollegato = p.id;
        presenza.connetti(p.id, socket.id);
        io.emit('partecipanti:aggiornati');
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
