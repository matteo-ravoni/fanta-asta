const express = require('express');
const { pickNextPlayer, emettiStato, log } = require('./auction');

function creaRouter(getDb, io) {
    const router = express.Router();

    router.get('/log-admin', (req, res) => {
        const righe = getDb().prepare(`
            SELECT l.id, l.creato_il, l.tipo_azione, l.dettagli,
                g.nome AS giocatore_nome, p.nome_squadra
            FROM log_admin l
            LEFT JOIN giocatori g ON g.id = l.giocatore_id
            LEFT JOIN partecipanti p ON p.id = l.partecipante_id
            ORDER BY l.creato_il DESC, l.id DESC
        `).all();
        res.json(righe.map((r) => ({ ...r, dettagli: r.dettagli ? JSON.parse(r.dettagli) : {} })));
    });

    router.get('/assegnazioni', (req, res) => {
        const righe = getDb().prepare(`
            SELECT a.id, a.prezzo, a.assegnato_il,
                g.id AS giocatore_id, g.nome AS giocatore_nome, g.ruolo_classico, g.ruolo_mantra,
                p.id AS partecipante_id, p.nome_squadra
            FROM assegnazioni a
            JOIN giocatori g ON g.id = a.giocatore_id
            JOIN partecipanti p ON p.id = a.partecipante_id
            ORDER BY a.assegnato_il DESC, a.id DESC
        `).all();
        res.json(righe);
    });

    router.get('/giocatori/:id/offerte', (req, res) => {
        const righe = getDb().prepare(`
            SELECT o.id, o.importo, o.stato, o.creata_il, p.nome_squadra
            FROM offerte o JOIN partecipanti p ON p.id = o.partecipante_id
            WHERE o.giocatore_id = ?
            ORDER BY o.creata_il
        `).all(req.params.id);
        res.json(righe);
    });

    router.post('/admin/annulla-ultima', (req, res) => {
        const db = getDb();
        const ultima = db.prepare('SELECT * FROM assegnazioni ORDER BY id DESC LIMIT 1').get();
        if (!ultima) return res.status(404).json({ errori: ['Nessuna assegnazione da annullare.'] });

        db.transaction(() => {
            const statoAttuale = db.prepare('SELECT giocatore_corrente_id FROM stato_asta WHERE id = 1').get();
            if (statoAttuale.giocatore_corrente_id) {
                db.prepare("UPDATE giocatori SET stato = 'da_bandire' WHERE id = ?").run(statoAttuale.giocatore_corrente_id);
            }

            db.prepare('DELETE FROM assegnazioni WHERE id = ?').run(ultima.id);
            db.prepare('UPDATE partecipanti SET crediti_residui = crediti_residui + ? WHERE id = ?').run(ultima.prezzo, ultima.partecipante_id);
            db.prepare("UPDATE giocatori SET stato = 'in_asta' WHERE id = ?").run(ultima.giocatore_id);

            const nuovaScadenza = new Date(Date.now() + 5000).toISOString();
            db.prepare(`UPDATE stato_asta SET giocatore_corrente_id = ?, offerta_corrente = ?,
                partecipante_in_testa_id = ?, countdown_scadenza = ? WHERE id = 1`)
                .run(ultima.giocatore_id, ultima.prezzo, ultima.partecipante_id, nuovaScadenza);

            log(db, 'annulla_assegnazione', { assegnazione_id: ultima.id, prezzo: ultima.prezzo }, { giocatore_id: ultima.giocatore_id, partecipante_id: ultima.partecipante_id });
        })();

        emettiStato(io, db);
        res.json({ ok: true });
    });

    router.post('/admin/svincola', (req, res) => {
        const db = getDb();
        const giocatoreId = Number(req.body.giocatore_id);
        const assegnazione = db.prepare('SELECT * FROM assegnazioni WHERE giocatore_id = ?').get(giocatoreId);
        if (!assegnazione) return res.status(404).json({ errori: ['Il giocatore non risulta assegnato.'] });

        db.transaction(() => {
            db.prepare('DELETE FROM assegnazioni WHERE id = ?').run(assegnazione.id);
            db.prepare('UPDATE partecipanti SET crediti_residui = crediti_residui + ? WHERE id = ?').run(assegnazione.prezzo, assegnazione.partecipante_id);
            db.prepare("UPDATE giocatori SET stato = 'da_bandire' WHERE id = ?").run(giocatoreId);
            log(db, 'svincola', { prezzo: assegnazione.prezzo }, { giocatore_id: giocatoreId, partecipante_id: assegnazione.partecipante_id });
        })();

        emettiStato(io, db);
        res.json({ ok: true });
    });

    router.post('/admin/modifica-assegnazione', (req, res) => {
        const db = getDb();
        const assegnazioneId = Number(req.body.assegnazione_id);
        const assegnazione = db.prepare('SELECT * FROM assegnazioni WHERE id = ?').get(assegnazioneId);
        if (!assegnazione) return res.status(404).json({ errori: ['Assegnazione non trovata.'] });

        const nuovoGiocatoreId = req.body.giocatore_id !== undefined ? Number(req.body.giocatore_id) : assegnazione.giocatore_id;
        const nuovoPartecipanteId = req.body.partecipante_id !== undefined ? Number(req.body.partecipante_id) : assegnazione.partecipante_id;
        const nuovoPrezzo = req.body.prezzo !== undefined ? Number(req.body.prezzo) : assegnazione.prezzo;

        if (!Number.isInteger(nuovoPrezzo) || nuovoPrezzo <= 0) {
            return res.status(400).json({ errori: ['Il prezzo deve essere un intero positivo.'] });
        }
        const nuovoPartecipante = db.prepare('SELECT * FROM partecipanti WHERE id = ?').get(nuovoPartecipanteId);
        if (!nuovoPartecipante) return res.status(404).json({ errori: ['Partecipante non trovato.'] });

        if (nuovoGiocatoreId !== assegnazione.giocatore_id) {
            const nuovoGiocatore = db.prepare('SELECT stato FROM giocatori WHERE id = ?').get(nuovoGiocatoreId);
            if (!nuovoGiocatore || nuovoGiocatore.stato !== 'da_bandire') {
                return res.status(400).json({ errori: ['Il nuovo giocatore deve essere ancora nel listone (da bandire).'] });
            }
        }

        // crediti disponibili per il nuovo partecipante, considerando che l'eventuale prezzo attuale
        // va prima "restituito" se l'assegnazione modificata è già sua
        const creditiDisponibili = nuovoPartecipanteId === assegnazione.partecipante_id
            ? nuovoPartecipante.crediti_residui + assegnazione.prezzo
            : nuovoPartecipante.crediti_residui;
        if (nuovoPrezzo > creditiDisponibili) {
            return res.status(403).json({ errori: [`${nuovoPartecipante.nome_squadra} non ha abbastanza crediti residui.`] });
        }

        db.transaction(() => {
            db.prepare('UPDATE partecipanti SET crediti_residui = crediti_residui + ? WHERE id = ?').run(assegnazione.prezzo, assegnazione.partecipante_id);
            db.prepare('UPDATE partecipanti SET crediti_residui = crediti_residui - ? WHERE id = ?').run(nuovoPrezzo, nuovoPartecipanteId);

            if (nuovoGiocatoreId !== assegnazione.giocatore_id) {
                db.prepare("UPDATE giocatori SET stato = 'da_bandire' WHERE id = ?").run(assegnazione.giocatore_id);
                db.prepare("UPDATE giocatori SET stato = 'assegnato' WHERE id = ?").run(nuovoGiocatoreId);
            }

            db.prepare('UPDATE assegnazioni SET giocatore_id = ?, partecipante_id = ?, prezzo = ? WHERE id = ?')
                .run(nuovoGiocatoreId, nuovoPartecipanteId, nuovoPrezzo, assegnazioneId);

            log(db, 'modifica_assegnazione', {
                assegnazione_id: assegnazioneId,
                prima: { giocatore_id: assegnazione.giocatore_id, partecipante_id: assegnazione.partecipante_id, prezzo: assegnazione.prezzo },
                dopo: { giocatore_id: nuovoGiocatoreId, partecipante_id: nuovoPartecipanteId, prezzo: nuovoPrezzo },
            }, { giocatore_id: nuovoGiocatoreId, partecipante_id: nuovoPartecipanteId });
        })();

        emettiStato(io, db);
        res.json({ ok: true });
    });

    router.post('/admin/reset-rose', (req, res) => {
        const db = getDb();
        const configurazione = db.prepare('SELECT crediti_iniziali FROM configurazione WHERE id = 1').get();
        if (!configurazione) return res.status(400).json({ errori: ['Nessuna configurazione presente.'] });

        db.transaction(() => {
            db.prepare('DELETE FROM offerte').run();
            db.prepare('DELETE FROM assegnazioni').run();
            db.prepare("UPDATE giocatori SET stato = 'da_bandire', ordine_saltato = NULL").run();
            db.prepare('UPDATE partecipanti SET crediti_residui = ?').run(configurazione.crediti_iniziali);
            db.prepare(`UPDATE stato_asta SET stato = 'non_iniziata', giocatore_corrente_id = NULL, offerta_corrente = NULL,
                partecipante_in_testa_id = NULL, countdown_scadenza = NULL, accessi_bloccati = 0, partecipante_disconnesso_id = NULL
                WHERE id = 1`).run();
            log(db, 'reset_rose', {});
        })();

        emettiStato(io, db);
        res.json({ ok: true });
    });

    router.post('/admin/reset-completo', (req, res) => {
        const db = getDb();
        db.transaction(() => {
            db.prepare(`UPDATE stato_asta SET stato = 'non_iniziata', giocatore_corrente_id = NULL, offerta_corrente = NULL,
                partecipante_in_testa_id = NULL, countdown_scadenza = NULL, accessi_bloccati = 0, partecipante_disconnesso_id = NULL
                WHERE id = 1`).run();
            db.prepare('DELETE FROM offerte').run();
            db.prepare('DELETE FROM assegnazioni').run();
            db.prepare('DELETE FROM log_admin').run();
            db.prepare('DELETE FROM giocatori').run();
            db.prepare('DELETE FROM partecipanti').run();
            db.prepare('DELETE FROM configurazione').run();
            log(db, 'reset_completo', {});
        })();

        emettiStato(io, db);
        io.emit('stato_asta:aggiornato');
        res.json({ ok: true });
    });

    return router;
}

module.exports = { creaRouter };
