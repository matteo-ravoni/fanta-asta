const express = require('express');

function log(db, tipo_azione, dettagli) {
    db.prepare('INSERT INTO log_admin (tipo_azione, dettagli) VALUES (?, ?)').run(tipo_azione, JSON.stringify(dettagli ?? {}));
}

function creaRouter(getDb, io) {
    const router = express.Router();

    router.post('/accessi', (req, res) => {
        const db = getDb();
        const stato = db.prepare('SELECT stato FROM stato_asta WHERE id = 1').get();
        if (stato.stato !== 'non_iniziata') {
            return res.status(403).json({ errori: ["Non è più possibile modificare gli accessi: l'asta è già stata avviata."] });
        }

        const bloccato = !!req.body.bloccato;
        db.prepare('UPDATE stato_asta SET accessi_bloccati = ? WHERE id = 1').run(bloccato ? 1 : 0);
        log(db, bloccato ? 'blocca_accessi' : 'sblocca_accessi');

        io.emit('stato_asta:aggiornato');
        res.json({ ok: true, accessi_bloccati: bloccato });
    });

    router.post('/asta/inizia', (req, res) => {
        const db = getDb();
        const stato = db.prepare('SELECT * FROM stato_asta WHERE id = 1').get();
        const configurazione = db.prepare('SELECT id FROM configurazione WHERE id = 1').get();

        if (stato.stato !== 'non_iniziata') {
            return res.status(403).json({ errori: ["L'asta è già stata avviata."] });
        }
        if (!configurazione) {
            return res.status(400).json({ errori: ["Salva prima la configurazione dell'asta."] });
        }
        if (!stato.accessi_bloccati) {
            return res.status(403).json({ errori: ['Blocca gli accessi prima di iniziare.'] });
        }

        db.prepare("UPDATE stato_asta SET stato = 'in_corso' WHERE id = 1").run();
        log(db, 'inizia_asta');

        io.emit('stato_asta:aggiornato');
        res.json({ ok: true });
    });

    return router;
}

module.exports = { creaRouter };
