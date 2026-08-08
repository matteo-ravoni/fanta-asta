const express = require('express');
const multer = require('multer');
const { parseListone } = require('./listone');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const RUOLI_ORDINE = ['P', 'D', 'C', 'A'];

function shuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// "per_ruolo": raggruppa per ruolo classico (P poi D poi C poi A), ordine libero all'interno di ogni gruppo.
function calcolaOrdineUscita(giocatori, criterio) {
    if (criterio === 'alfabetico') {
        return [...giocatori].sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));
    }
    if (criterio === 'per_ruolo') {
        return RUOLI_ORDINE.flatMap((ruolo) => shuffle(giocatori.filter((g) => g.ruolo_classico === ruolo)));
    }
    return shuffle(giocatori);
}

function leggiBodyConfigurazione(body) {
    const numero = (v) => (v === undefined || v === '' ? null : Number(v));
    return {
        numero_partecipanti: numero(body.numero_partecipanti),
        nomi_squadre: (() => {
            try {
                return JSON.parse(body.nomi_squadre);
            } catch {
                return null;
            }
        })(),
        crediti_iniziali: numero(body.crediti_iniziali),
        tipo_asta: body.tipo_asta,
        slot_portieri: numero(body.slot_portieri),
        slot_difensori: numero(body.slot_difensori),
        slot_centrocampisti: numero(body.slot_centrocampisti),
        slot_attaccanti: numero(body.slot_attaccanti),
        slot_totale_mantra: numero(body.slot_totale_mantra),
        ordine_uscita: body.ordine_uscita,
    };
}

function validaConfigurazione(cfg) {
    const errori = [];

    if (!Number.isInteger(cfg.numero_partecipanti) || cfg.numero_partecipanti < 2 || cfg.numero_partecipanti > 20) {
        errori.push('Il numero di partecipanti deve essere un intero tra 2 e 20.');
    }

    if (!Array.isArray(cfg.nomi_squadre) || cfg.nomi_squadre.length !== cfg.numero_partecipanti) {
        errori.push('Il numero di nomi squadra inseriti non corrisponde al numero di partecipanti.');
    } else {
        const nomiPuliti = cfg.nomi_squadre.map((n) => (typeof n === 'string' ? n.trim() : ''));
        if (nomiPuliti.some((n) => n.length === 0)) {
            errori.push('Tutti i nomi delle squadre devono essere compilati.');
        }
        if (new Set(nomiPuliti.map((n) => n.toLowerCase())).size !== nomiPuliti.length) {
            errori.push('I nomi delle squadre devono essere tutti diversi.');
        }
    }

    if (!Number.isInteger(cfg.crediti_iniziali) || cfg.crediti_iniziali <= 0) {
        errori.push('I crediti per partecipante devono essere un intero positivo.');
    }

    if (!['classica', 'mantra'].includes(cfg.tipo_asta)) {
        errori.push('Il tipo di asta deve essere "classica" o "mantra".');
    } else if (cfg.tipo_asta === 'classica') {
        const slot = [cfg.slot_portieri, cfg.slot_difensori, cfg.slot_centrocampisti, cfg.slot_attaccanti];
        if (slot.some((v) => !Number.isInteger(v) || v <= 0)) {
            errori.push("Per l'asta classica servono 4 numeri interi positivi (portieri, difensori, centrocampisti, attaccanti).");
        }
    } else if (cfg.tipo_asta === 'mantra') {
        if (!Number.isInteger(cfg.slot_totale_mantra) || cfg.slot_totale_mantra <= 0) {
            errori.push("Per l'asta mantra serve il numero totale di giocatori in rosa.");
        }
        if (!Number.isInteger(cfg.slot_portieri) || cfg.slot_portieri <= 0) {
            errori.push("Per l'asta mantra serve il numero di portieri.");
        }
        if (Number.isInteger(cfg.slot_totale_mantra) && Number.isInteger(cfg.slot_portieri) && cfg.slot_portieri >= cfg.slot_totale_mantra) {
            errori.push('Il numero di portieri deve essere inferiore al totale dei giocatori in rosa.');
        }
    }

    if (!['casuale', 'per_ruolo', 'alfabetico'].includes(cfg.ordine_uscita)) {
        errori.push('L\'ordine di uscita deve essere "casuale", "per_ruolo" o "alfabetico".');
    }

    return errori;
}

function creaRouter(getDb) {
    const router = express.Router();

    router.get('/stato', (req, res) => {
        const stato = getDb().prepare('SELECT * FROM stato_asta WHERE id = 1').get();
        res.json(stato);
    });

    router.get('/giocatori', (req, res) => {
        const db = getDb();
        const { ruolo, q } = req.query;
        let sql = 'SELECT id, nome, squadra_reale, ruolo_classico, ruolo_mantra, quotazione_classica, quotazione_mantra, fvm_classica, fvm_mantra, stato FROM giocatori WHERE 1=1';
        const parametri = [];
        if (ruolo) {
            sql += ' AND ruolo_classico = ?';
            parametri.push(ruolo);
        }
        if (q) {
            sql += ' AND nome LIKE ?';
            parametri.push(`%${q}%`);
        }
        sql += ' ORDER BY ordine_uscita';
        res.json(db.prepare(sql).all(...parametri));
    });

    router.get('/configurazione', (req, res) => {
        const db = getDb();
        const configurazione = db.prepare('SELECT * FROM configurazione WHERE id = 1').get() ?? null;
        const partecipanti = db.prepare('SELECT id, nome_squadra, ordine, crediti_residui FROM partecipanti ORDER BY ordine').all();
        res.json({ configurazione, partecipanti });
    });

    router.post('/configurazione', upload.single('listone'), (req, res) => {
        const db = getDb();

        const stato = db.prepare('SELECT stato FROM stato_asta WHERE id = 1').get();
        if (stato.stato !== 'non_iniziata') {
            return res.status(403).json({ errori: ["La configurazione è bloccata: l'asta è già stata avviata."] });
        }

        if (!req.file) {
            return res.status(400).json({ errori: ['Carica il file del listone (.xlsx).'] });
        }

        const cfg = leggiBodyConfigurazione(req.body);
        const erroriConfig = validaConfigurazione(cfg);
        if (erroriConfig.length > 0) {
            return res.status(400).json({ errori: erroriConfig });
        }

        const { giocatori, errori: erroriListone } = parseListone(req.file.buffer);
        if (erroriListone) {
            return res.status(400).json({ errori: erroriListone });
        }

        const giocatoriOrdinati = calcolaOrdineUscita(giocatori, cfg.ordine_uscita);
        const partecipantiOrdinati = shuffle(cfg.nomi_squadre.map((n) => n.trim()));

        const salva = db.transaction(() => {
            db.prepare(`UPDATE stato_asta SET
                giocatore_corrente_id = NULL, offerta_corrente = NULL, partecipante_in_testa_id = NULL,
                countdown_scadenza = NULL, accessi_bloccati = 0, partecipante_disconnesso_id = NULL
                WHERE id = 1`).run();

            db.prepare('DELETE FROM log_admin').run();
            db.prepare('DELETE FROM offerte').run();
            db.prepare('DELETE FROM assegnazioni').run();
            db.prepare('DELETE FROM giocatori').run();
            db.prepare('DELETE FROM partecipanti').run();
            db.prepare('DELETE FROM configurazione').run();

            db.prepare(`INSERT INTO configurazione
                (id, numero_partecipanti, crediti_iniziali, tipo_asta, slot_portieri, slot_difensori, slot_centrocampisti, slot_attaccanti, slot_totale_mantra, ordine_uscita)
                VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
                cfg.numero_partecipanti, cfg.crediti_iniziali, cfg.tipo_asta,
                cfg.slot_portieri, cfg.slot_difensori, cfg.slot_centrocampisti, cfg.slot_attaccanti, cfg.slot_totale_mantra,
                cfg.ordine_uscita
            );

            const insPartecipante = db.prepare('INSERT INTO partecipanti (nome_squadra, ordine, crediti_residui) VALUES (?, ?, ?)');
            partecipantiOrdinati.forEach((nome, i) => insPartecipante.run(nome, i + 1, cfg.crediti_iniziali));

            const insGiocatore = db.prepare(`INSERT INTO giocatori
                (id_listone, nome, squadra_reale, ruolo_classico, ruolo_mantra, quotazione_classica, quotazione_mantra, fvm_classica, fvm_mantra, ordine_uscita)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            giocatoriOrdinati.forEach((g, i) => insGiocatore.run(
                g.id_listone, g.nome, g.squadra_reale, g.ruolo_classico, g.ruolo_mantra,
                g.quotazione_classica, g.quotazione_mantra, g.fvm_classica, g.fvm_mantra, i + 1
            ));
        });

        salva();

        res.json({ ok: true, numero_giocatori: giocatoriOrdinati.length, numero_partecipanti: partecipantiOrdinati.length });
    });

    return router;
}

module.exports = { creaRouter, calcolaOrdineUscita, validaConfigurazione };
