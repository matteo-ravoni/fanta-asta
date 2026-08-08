const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { getDb } = require('./db');
const configRouter = require('./config');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/api/health', (req, res) => {
    const db = getDb();
    const { count } = db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'").get();
    res.json({ ok: true, tabelle: count, client_connessi: io.engine.clientsCount });
});

app.use('/api', configRouter.creaRouter(getDb));

app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

io.on('connection', (socket) => {
    console.log(`Client connesso: ${socket.id} (totale: ${io.engine.clientsCount})`);
    io.emit('partecipanti:online', io.engine.clientsCount);

    socket.on('disconnect', () => {
        console.log(`Client disconnesso: ${socket.id} (totale: ${io.engine.clientsCount})`);
        io.emit('partecipanti:online', io.engine.clientsCount);
    });
});

getDb();
server.listen(PORT, () => {
    console.log(`Fantalega in ascolto su http://localhost:${PORT}`);
});
