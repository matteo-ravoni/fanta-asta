const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { emettiStato, log } = require('./auction');

const EXPORT_DIR = path.join(__dirname, '..', 'data', 'export');

// Formato compatibile app Leghe Fantacalcio: per ogni squadra una riga separatore "$,$,$",
// poi una riga per giocatore con nome_squadra,id_listone,prezzo (niente nome giocatore).
function generaCsvRose(db) {
    const partecipanti = db.prepare('SELECT id, nome_squadra FROM partecipanti ORDER BY ordine').all();
    const righe = [];
    for (const p of partecipanti) {
        righe.push('$,$,$');
        const acquisti = db.prepare(`
            SELECT g.id_listone, a.prezzo
            FROM assegnazioni a JOIN giocatori g ON g.id = a.giocatore_id
            WHERE a.partecipante_id = ?
            ORDER BY a.assegnato_il
        `).all(p.id);
        for (const acquisto of acquisti) {
            righe.push(`${p.nome_squadra},${acquisto.id_listone},${acquisto.prezzo}`);
        }
    }
    return righe.join('\n') + '\n';
}

function generaExcelCompleto(db) {
    const rose = db.prepare(`
        SELECT p.nome_squadra AS Squadra, g.nome AS Giocatore, g.ruolo_classico AS Ruolo,
            g.squadra_reale AS "Squadra reale", a.prezzo AS Prezzo
        FROM assegnazioni a
        JOIN giocatori g ON g.id = a.giocatore_id
        JOIN partecipanti p ON p.id = a.partecipante_id
        ORDER BY p.ordine, a.prezzo DESC
    `).all();

    const logRighe = db.prepare(`
        SELECT l.creato_il AS Timestamp, l.tipo_azione AS Azione,
            g.nome AS Giocatore, p.nome_squadra AS Squadra, l.dettagli AS Dettagli
        FROM log_admin l
        LEFT JOIN giocatori g ON g.id = l.giocatore_id
        LEFT JOIN partecipanti p ON p.id = l.partecipante_id
        ORDER BY l.creato_il
    `).all();

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rose), 'Rose');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(logRighe), 'Log');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function generaDumpJson(db) {
    return {
        esportato_il: new Date().toISOString(),
        configurazione: db.prepare('SELECT * FROM configurazione WHERE id = 1').get(),
        partecipanti: db.prepare('SELECT * FROM partecipanti ORDER BY ordine').all(),
        giocatori: db.prepare('SELECT * FROM giocatori ORDER BY id').all(),
        assegnazioni: db.prepare('SELECT * FROM assegnazioni ORDER BY id').all(),
        offerte: db.prepare('SELECT * FROM offerte ORDER BY id').all(),
        log_admin: db.prepare('SELECT * FROM log_admin ORDER BY id').all(),
    };
}

function creaRouter(getDb, io) {
    const router = express.Router();

    router.post('/asta/chiudi', (req, res) => {
        const db = getDb();
        const stato = db.prepare('SELECT stato FROM stato_asta WHERE id = 1').get();
        if (stato.stato !== 'in_corso' && stato.stato !== 'sospesa') {
            return res.status(403).json({ errori: ["L'asta non è attiva."] });
        }

        db.prepare("UPDATE stato_asta SET stato = 'conclusa' WHERE id = 1").run();
        log(db, 'chiudi_asta', {});

        fs.mkdirSync(EXPORT_DIR, { recursive: true });
        fs.writeFileSync(path.join(EXPORT_DIR, 'rose.csv'), generaCsvRose(db));
        fs.writeFileSync(path.join(EXPORT_DIR, 'asta_completo.xlsx'), generaExcelCompleto(db));
        fs.writeFileSync(path.join(EXPORT_DIR, 'dump.json'), JSON.stringify(generaDumpJson(db), null, 2));

        emettiStato(io, db);
        res.json({
            ok: true,
            file: { csv: '/api/export/rose.csv', excel: '/api/export/asta_completo.xlsx', json: '/api/export/dump.json' },
        });
    });

    router.get('/export/:filename', (req, res) => {
        const filePath = path.join(EXPORT_DIR, path.basename(req.params.filename));
        if (!fs.existsSync(filePath)) return res.status(404).end();
        res.download(filePath);
    });

    return router;
}

module.exports = { creaRouter, generaCsvRose, generaExcelCompleto, generaDumpJson };
