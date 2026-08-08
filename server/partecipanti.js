const express = require('express');
const crypto = require('crypto');
const presenza = require('./presenza');

function creaRouter(getDb, io) {
    const router = express.Router();

    router.get('/squadre', (req, res) => {
        const db = getDb();
        const stato = db.prepare('SELECT accessi_bloccati FROM stato_asta WHERE id = 1').get();
        const squadre = db.prepare('SELECT nome_squadra, ordine, (token IS NOT NULL) AS occupata FROM partecipanti ORDER BY ordine').all();
        res.json({
            accessi_bloccati: !!stato.accessi_bloccati,
            squadre: squadre.map((s) => ({ nome_squadra: s.nome_squadra, ordine: s.ordine, occupata: !!s.occupata })),
        });
    });

    router.get('/partecipanti', (req, res) => {
        const db = getDb();
        const righe = db.prepare('SELECT id, nome_squadra, ordine, crediti_residui FROM partecipanti ORDER BY ordine').all();
        res.json(righe.map((r) => ({ ...r, connesso: presenza.isConnesso(r.id) })));
    });

    router.get('/partecipanti/me', (req, res) => {
        const token = req.query.token;
        if (!token) return res.status(400).json({ errori: ['Token mancante.'] });

        const p = getDb().prepare('SELECT id, nome_squadra, ordine, crediti_residui FROM partecipanti WHERE token = ?').get(token);
        if (!p) return res.status(404).json({ errori: ['Sessione non valida.'] });
        res.json(p);
    });

    router.post('/join', (req, res) => {
        const db = getDb();
        const stato = db.prepare('SELECT accessi_bloccati FROM stato_asta WHERE id = 1').get();
        const nomeSquadra = typeof req.body.nome_squadra === 'string' ? req.body.nome_squadra.trim() : '';

        if (!nomeSquadra) {
            return res.status(400).json({ errori: ['Scegli una squadra.'] });
        }

        const partecipante = db.prepare('SELECT id, token FROM partecipanti WHERE nome_squadra = ?').get(nomeSquadra);
        if (!partecipante) {
            return res.status(404).json({ errori: ['Squadra non trovata.'] });
        }
        if (partecipante.token) {
            return res.status(409).json({ errori: ['Questa squadra è già stata scelta da qualcun altro.'] });
        }
        if (stato.accessi_bloccati) {
            return res.status(403).json({ errori: ["Gli accessi sono stati bloccati dall'host."] });
        }

        const token = crypto.randomUUID();
        db.prepare('UPDATE partecipanti SET token = ? WHERE id = ?').run(token, partecipante.id);

        io.emit('partecipanti:aggiornati');
        res.json({
            token,
            partecipante: db.prepare('SELECT id, nome_squadra, ordine, crediti_residui FROM partecipanti WHERE id = ?').get(partecipante.id),
        });
    });

    return router;
}

module.exports = { creaRouter };
