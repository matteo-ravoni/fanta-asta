const express = require('express');

function log(db, tipo_azione, dettagli) {
    db.prepare('INSERT INTO log_admin (tipo_azione, dettagli) VALUES (?, ?)').run(tipo_azione, JSON.stringify(dettagli ?? {}));
}

// Determina lo slot totale/per-ruolo ancora liberi per un partecipante, in base al tipo di asta.
function calcolaSlotRimanenti(db, partecipanteId, configurazione) {
    if (configurazione.tipo_asta === 'classica') {
        const righe = db.prepare(`
            SELECT g.ruolo_classico AS ruolo, COUNT(*) AS n
            FROM assegnazioni a JOIN giocatori g ON g.id = a.giocatore_id
            WHERE a.partecipante_id = ?
            GROUP BY g.ruolo_classico
        `).all(partecipanteId);
        const contati = { P: 0, D: 0, C: 0, A: 0 };
        righe.forEach((r) => { contati[r.ruolo] = r.n; });
        const perRuolo = {
            P: configurazione.slot_portieri - contati.P,
            D: configurazione.slot_difensori - contati.D,
            C: configurazione.slot_centrocampisti - contati.C,
            A: configurazione.slot_attaccanti - contati.A,
        };
        return { totale: perRuolo.P + perRuolo.D + perRuolo.C + perRuolo.A, perRuolo };
    }

    const { n: totaleAssegnati } = db.prepare('SELECT COUNT(*) AS n FROM assegnazioni WHERE partecipante_id = ?').get(partecipanteId);
    const { n: portieriAssegnati } = db.prepare(`
        SELECT COUNT(*) AS n FROM assegnazioni a JOIN giocatori g ON g.id = a.giocatore_id
        WHERE a.partecipante_id = ? AND g.ruolo_classico = 'P'
    `).get(partecipanteId);
    return {
        totale: configurazione.slot_totale_mantra - totaleAssegnati,
        perRuolo: { P: configurazione.slot_portieri - portieriAssegnati },
    };
}

// Sceglie il prossimo giocatore da mettere in asta (solo dal giro principale: la
// riproposizione dei saltati a fine giro è responsabilità della tappa 10).
function pickNextPlayer(db) {
    const prossimo = db.prepare("SELECT id FROM giocatori WHERE stato = 'da_bandire' ORDER BY ordine_uscita LIMIT 1").get();
    if (!prossimo) {
        db.prepare('UPDATE stato_asta SET giocatore_corrente_id = NULL WHERE id = 1').run();
        return null;
    }
    db.prepare("UPDATE giocatori SET stato = 'in_asta' WHERE id = ?").run(prossimo.id);
    db.prepare('UPDATE stato_asta SET giocatore_corrente_id = ? WHERE id = 1').run(prossimo.id);
    return prossimo;
}

// Stato completo trasmesso a tutti i client. Non include mai la coda futura dei giocatori.
function caricaStatoCompleto(db) {
    const stato = db.prepare('SELECT * FROM stato_asta WHERE id = 1').get();
    const configurazione = db.prepare('SELECT tipo_asta FROM configurazione WHERE id = 1').get();

    const giocatoreCorrente = stato.giocatore_corrente_id
        ? db.prepare(`SELECT id, nome, squadra_reale, ruolo_classico, ruolo_mantra, quotazione_classica,
            quotazione_mantra, fvm_classica, fvm_mantra FROM giocatori WHERE id = ?`).get(stato.giocatore_corrente_id)
        : null;

    const partecipanteInTesta = stato.partecipante_in_testa_id
        ? db.prepare('SELECT id, nome_squadra FROM partecipanti WHERE id = ?').get(stato.partecipante_in_testa_id)
        : null;

    const partecipanteDisconnesso = stato.partecipante_disconnesso_id
        ? db.prepare('SELECT id, nome_squadra FROM partecipanti WHERE id = ?').get(stato.partecipante_disconnesso_id)
        : null;

    const rilanciInAttesa = stato.giocatore_corrente_id
        ? db.prepare(`
            SELECT o.id, o.importo, o.creata_il, p.id AS partecipante_id, p.nome_squadra
            FROM offerte o JOIN partecipanti p ON p.id = o.partecipante_id
            WHERE o.giocatore_id = ? AND o.stato = 'in_attesa_host'
            ORDER BY o.creata_il
        `).all(stato.giocatore_corrente_id).map((r) => ({
            id: r.id,
            importo: r.importo,
            creata_il: r.creata_il,
            partecipante: { id: r.partecipante_id, nome_squadra: r.nome_squadra },
        }))
        : [];

    const partecipanti = db.prepare('SELECT id, nome_squadra, ordine, crediti_residui FROM partecipanti ORDER BY ordine').all();
    const conteggiRuoli = db.prepare(`
        SELECT a.partecipante_id, g.ruolo_classico AS ruolo, COUNT(*) AS n
        FROM assegnazioni a JOIN giocatori g ON g.id = a.giocatore_id
        GROUP BY a.partecipante_id, g.ruolo_classico
    `).all();

    const rose = partecipanti.map((p) => {
        const ruoli = { P: 0, D: 0, C: 0, A: 0 };
        conteggiRuoli.filter((c) => c.partecipante_id === p.id).forEach((c) => { ruoli[c.ruolo] = c.n; });
        return {
            id: p.id,
            nome_squadra: p.nome_squadra,
            ordine: p.ordine,
            crediti_residui: p.crediti_residui,
            ruoli,
            totale: ruoli.P + ruoli.D + ruoli.C + ruoli.A,
        };
    });

    const { rimasti } = db.prepare("SELECT COUNT(*) AS rimasti FROM giocatori WHERE stato IN ('da_bandire', 'saltato')").get();

    return {
        stato: stato.stato,
        giocatore_corrente: giocatoreCorrente,
        offerta_corrente: stato.offerta_corrente,
        partecipante_in_testa: partecipanteInTesta,
        countdown_scadenza: stato.countdown_scadenza,
        partecipante_disconnesso: partecipanteDisconnesso,
        rilanci_in_attesa: rilanciInAttesa,
        rose,
        asta_esaurita: !giocatoreCorrente && rimasti === 0,
        tipo_asta: configurazione ? configurazione.tipo_asta : null,
    };
}

function emettiStato(io, db) {
    io.emit('asta:stato', caricaStatoCompleto(db));
}

function creaRouter(getDb, io) {
    const router = express.Router();

    router.get('/asta/stato', (req, res) => {
        res.json(caricaStatoCompleto(getDb()));
    });

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

        db.transaction(() => {
            db.prepare("UPDATE stato_asta SET stato = 'in_corso' WHERE id = 1").run();
            log(db, 'inizia_asta', {});
            pickNextPlayer(db);
        })();

        io.emit('stato_asta:aggiornato');
        emettiStato(io, db);
        res.json({ ok: true });
    });

    router.post('/rilancio', (req, res) => {
        const db = getDb();
        const token = req.body.token;
        const importo = Number(req.body.importo);

        const partecipante = db.prepare('SELECT * FROM partecipanti WHERE token = ?').get(token);
        if (!partecipante) return res.status(404).json({ errori: ['Sessione non valida.'] });

        const stato = db.prepare('SELECT * FROM stato_asta WHERE id = 1').get();
        if (stato.stato !== 'in_corso') {
            return res.status(403).json({ errori: ["L'asta non è attiva al momento."] });
        }
        if (!stato.giocatore_corrente_id) {
            return res.status(400).json({ errori: ['Nessun giocatore in asta al momento.'] });
        }
        if (!Number.isInteger(importo) || importo <= 0) {
            return res.status(400).json({ errori: ['Importo non valido.'] });
        }

        const sogliaMinima = stato.offerta_corrente ?? 0;
        if (importo <= sogliaMinima) {
            return res.status(400).json({ errori: [`Il rilancio deve superare ${sogliaMinima} crediti.`] });
        }

        const configurazione = db.prepare('SELECT * FROM configurazione WHERE id = 1').get();
        const giocatore = db.prepare('SELECT ruolo_classico FROM giocatori WHERE id = ?').get(stato.giocatore_corrente_id);
        const slot = calcolaSlotRimanenti(db, partecipante.id, configurazione);

        if (slot.totale <= 0) {
            return res.status(403).json({ errori: ['La tua rosa è già completa.'] });
        }
        if (configurazione.tipo_asta === 'classica' && slot.perRuolo[giocatore.ruolo_classico] <= 0) {
            return res.status(403).json({ errori: [`Hai già completato gli slot per il ruolo ${giocatore.ruolo_classico}.`] });
        }
        if (configurazione.tipo_asta === 'mantra' && giocatore.ruolo_classico === 'P' && slot.perRuolo.P <= 0) {
            return res.status(403).json({ errori: ['Hai già completato gli slot portiere.'] });
        }

        const massimoPuntabile = partecipante.crediti_residui - (slot.totale - 1);
        if (importo > massimoPuntabile) {
            return res.status(403).json({
                errori: [`Rilancio troppo alto: devi lasciare almeno 1 credito per ognuno dei tuoi ${slot.totale - 1} slot rimanenti dopo questo acquisto.`],
            });
        }

        const ora = Date.now();
        const inZonaPostZero = stato.countdown_scadenza !== null && ora >= new Date(stato.countdown_scadenza).getTime();
        const nuovoStatoOfferta = inZonaPostZero ? 'in_attesa_host' : 'accettata_automatica';

        db.prepare('INSERT INTO offerte (giocatore_id, partecipante_id, importo, stato) VALUES (?, ?, ?, ?)')
            .run(stato.giocatore_corrente_id, partecipante.id, importo, nuovoStatoOfferta);

        if (!inZonaPostZero) {
            const nuovaScadenza = new Date(ora + 5000).toISOString();
            db.prepare('UPDATE stato_asta SET offerta_corrente = ?, partecipante_in_testa_id = ?, countdown_scadenza = ? WHERE id = 1')
                .run(importo, partecipante.id, nuovaScadenza);
        }

        emettiStato(io, db);
        res.json({ ok: true, stato: nuovoStatoOfferta });
    });

    router.post('/rilanci/:id/accetta', (req, res) => {
        const db = getDb();
        const offerta = db.prepare('SELECT * FROM offerte WHERE id = ?').get(req.params.id);
        if (!offerta || offerta.stato !== 'in_attesa_host') {
            return res.status(404).json({ errori: ['Rilancio non trovato o già gestito.'] });
        }
        const stato = db.prepare('SELECT giocatore_corrente_id FROM stato_asta WHERE id = 1').get();
        if (offerta.giocatore_id !== stato.giocatore_corrente_id) {
            return res.status(409).json({ errori: ['Il giocatore non è più in asta.'] });
        }

        db.transaction(() => {
            db.prepare("UPDATE offerte SET stato = 'accettata_host' WHERE id = ?").run(offerta.id);
            db.prepare("UPDATE offerte SET stato = 'rifiutata_host' WHERE giocatore_id = ? AND stato = 'in_attesa_host' AND importo <= ?")
                .run(offerta.giocatore_id, offerta.importo);
            const nuovaScadenza = new Date(Date.now() + 5000).toISOString();
            db.prepare('UPDATE stato_asta SET offerta_corrente = ?, partecipante_in_testa_id = ?, countdown_scadenza = ? WHERE id = 1')
                .run(offerta.importo, offerta.partecipante_id, nuovaScadenza);
            log(db, 'accetta_rilancio', { offerta_id: offerta.id, giocatore_id: offerta.giocatore_id, partecipante_id: offerta.partecipante_id, importo: offerta.importo });
        })();

        emettiStato(io, db);
        res.json({ ok: true });
    });

    router.post('/rilanci/:id/rifiuta', (req, res) => {
        const db = getDb();
        const offerta = db.prepare('SELECT * FROM offerte WHERE id = ?').get(req.params.id);
        if (!offerta || offerta.stato !== 'in_attesa_host') {
            return res.status(404).json({ errori: ['Rilancio non trovato o già gestito.'] });
        }

        db.prepare("UPDATE offerte SET stato = 'rifiutata_host' WHERE id = ?").run(offerta.id);
        log(db, 'rifiuta_rilancio', { offerta_id: offerta.id });

        emettiStato(io, db);
        res.json({ ok: true });
    });

    router.post('/asta/assegna', (req, res) => {
        const db = getDb();
        const stato = db.prepare('SELECT * FROM stato_asta WHERE id = 1').get();
        if (stato.stato !== 'in_corso') return res.status(403).json({ errori: ["L'asta non è attiva."] });
        if (!stato.giocatore_corrente_id || stato.offerta_corrente === null || !stato.partecipante_in_testa_id) {
            return res.status(400).json({ errori: ['Serve almeno un rilancio prima di assegnare il giocatore.'] });
        }

        const { giocatore_corrente_id: giocatoreId, partecipante_in_testa_id: partecipanteId, offerta_corrente: prezzo } = stato;

        db.transaction(() => {
            db.prepare('INSERT INTO assegnazioni (giocatore_id, partecipante_id, prezzo) VALUES (?, ?, ?)').run(giocatoreId, partecipanteId, prezzo);
            db.prepare("UPDATE giocatori SET stato = 'assegnato' WHERE id = ?").run(giocatoreId);
            db.prepare('UPDATE partecipanti SET crediti_residui = crediti_residui - ? WHERE id = ?').run(prezzo, partecipanteId);
            log(db, 'assegna', { giocatore_id: giocatoreId, partecipante_id: partecipanteId, prezzo });
            db.prepare(`UPDATE stato_asta SET giocatore_corrente_id = NULL, offerta_corrente = NULL,
                partecipante_in_testa_id = NULL, countdown_scadenza = NULL WHERE id = 1`).run();
            pickNextPlayer(db);
        })();

        emettiStato(io, db);
        res.json({ ok: true });
    });

    router.post('/asta/salta', (req, res) => {
        const db = getDb();
        const stato = db.prepare('SELECT * FROM stato_asta WHERE id = 1').get();
        if (stato.stato !== 'in_corso') return res.status(403).json({ errori: ["L'asta non è attiva."] });
        if (!stato.giocatore_corrente_id) return res.status(400).json({ errori: ['Nessun giocatore in asta al momento.'] });

        const giocatoreId = stato.giocatore_corrente_id;

        db.transaction(() => {
            const { max } = db.prepare('SELECT COALESCE(MAX(ordine_saltato), 0) AS max FROM giocatori').get();
            db.prepare("UPDATE giocatori SET stato = 'saltato', ordine_saltato = ? WHERE id = ?").run(max + 1, giocatoreId);
            db.prepare("UPDATE offerte SET stato = 'rifiutata_host' WHERE giocatore_id = ? AND stato = 'in_attesa_host'").run(giocatoreId);
            log(db, 'salta', { giocatore_id: giocatoreId });
            db.prepare(`UPDATE stato_asta SET giocatore_corrente_id = NULL, offerta_corrente = NULL,
                partecipante_in_testa_id = NULL, countdown_scadenza = NULL WHERE id = 1`).run();
            pickNextPlayer(db);
        })();

        emettiStato(io, db);
        res.json({ ok: true });
    });

    router.post('/asta/sospendi', (req, res) => {
        const db = getDb();
        const stato = db.prepare('SELECT stato FROM stato_asta WHERE id = 1').get();
        if (stato.stato !== 'in_corso') return res.status(403).json({ errori: ["L'asta non è in corso."] });

        db.prepare("UPDATE stato_asta SET stato = 'sospesa' WHERE id = 1").run();
        log(db, 'sospendi', { motivo: 'manuale' });

        emettiStato(io, db);
        res.json({ ok: true });
    });

    router.post('/asta/riprendi', (req, res) => {
        const db = getDb();
        const stato = db.prepare('SELECT stato FROM stato_asta WHERE id = 1').get();
        if (stato.stato !== 'sospesa') return res.status(403).json({ errori: ["L'asta non è sospesa."] });

        db.prepare("UPDATE stato_asta SET stato = 'in_corso', partecipante_disconnesso_id = NULL WHERE id = 1").run();
        log(db, 'riprendi', { motivo: 'manuale' });

        emettiStato(io, db);
        res.json({ ok: true });
    });

    return router;
}

function gestisciDisconnessione(db, io, partecipanteId) {
    const stato = db.prepare('SELECT stato FROM stato_asta WHERE id = 1').get();
    if (stato.stato !== 'in_corso') return;

    db.prepare("UPDATE stato_asta SET stato = 'sospesa', partecipante_disconnesso_id = ? WHERE id = 1").run(partecipanteId);
    log(db, 'sospendi', { motivo: 'disconnessione', partecipante_id: partecipanteId });
    emettiStato(io, db);
}

function gestisciRiconnessione(db, io, partecipanteId) {
    const stato = db.prepare('SELECT stato, partecipante_disconnesso_id FROM stato_asta WHERE id = 1').get();
    if (stato.stato === 'sospesa' && stato.partecipante_disconnesso_id === partecipanteId) {
        db.prepare("UPDATE stato_asta SET stato = 'in_corso', partecipante_disconnesso_id = NULL WHERE id = 1").run();
        log(db, 'riprendi', { motivo: 'riconnessione', partecipante_id: partecipanteId });
        emettiStato(io, db);
    }
}

module.exports = { creaRouter, gestisciDisconnessione, gestisciRiconnessione, calcolaSlotRimanenti, pickNextPlayer, caricaStatoCompleto };
