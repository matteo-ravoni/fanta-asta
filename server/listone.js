const XLSX = require('xlsx');

const COLONNE_RICHIESTE = ['Id', 'R', 'RM', 'Nome', 'Squadra', 'Qt.A', 'Qt.A M', 'FVM', 'FVM M'];
const RUOLI_VALIDI = ['P', 'D', 'C', 'A'];

function trovaFoglioPrincipale(workbook) {
    if (workbook.SheetNames.includes('Tutti')) return 'Tutti';
    return workbook.SheetNames.find((nome) => nome !== 'Ceduti') ?? null;
}

function trovaRigaIntestazione(righe) {
    const limite = Math.min(righe.length, 10);
    for (let i = 0; i < limite; i++) {
        if (righe[i] && righe[i][0] === 'Id') return i;
    }
    return -1;
}

// Legge un file .xlsx di listone Fantacalcio e ne estrae i giocatori.
// Ignora deliberatamente il foglio "Ceduti": quei giocatori non entrano nel listone bandibile.
function parseListone(buffer) {
    let workbook;
    try {
        workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
        return { errori: ['Il file caricato non è un .xlsx valido.'] };
    }

    const nomeFoglio = trovaFoglioPrincipale(workbook);
    if (!nomeFoglio) {
        return { errori: ['Il file non contiene fogli utilizzabili.'] };
    }

    const righe = XLSX.utils.sheet_to_json(workbook.Sheets[nomeFoglio], { header: 1, defval: null });
    const rigaIntestazione = trovaRigaIntestazione(righe);
    if (rigaIntestazione === -1) {
        return { errori: [`Impossibile trovare la riga di intestazione (colonna "Id") nel foglio "${nomeFoglio}".`] };
    }

    const intestazioni = righe[rigaIntestazione].map((h) => (h == null ? '' : String(h).trim()));
    const colonneMancanti = COLONNE_RICHIESTE.filter((c) => !intestazioni.includes(c));
    if (colonneMancanti.length > 0) {
        return { errori: [`Colonne mancanti nel listone: ${colonneMancanti.join(', ')}.`] };
    }

    const idx = {};
    COLONNE_RICHIESTE.forEach((c) => { idx[c] = intestazioni.indexOf(c); });

    const giocatori = [];
    for (let r = rigaIntestazione + 1; r < righe.length; r++) {
        const riga = righe[r];
        if (!riga || riga.every((v) => v === null)) continue;

        const idListone = riga[idx['Id']];
        const nome = riga[idx['Nome']];
        if (idListone == null || nome == null || String(nome).trim() === '') continue;

        giocatori.push({
            id_listone: Number(idListone),
            nome: String(nome).trim(),
            squadra_reale: String(riga[idx['Squadra']] ?? '').trim(),
            ruolo_classico: String(riga[idx['R']] ?? '').trim().toUpperCase(),
            ruolo_mantra: String(riga[idx['RM']] ?? '').trim(),
            quotazione_classica: Number(riga[idx['Qt.A']]) || 0,
            quotazione_mantra: Number(riga[idx['Qt.A M']]) || 0,
            fvm_classica: riga[idx['FVM']] != null ? Number(riga[idx['FVM']]) : null,
            fvm_mantra: riga[idx['FVM M']] != null ? Number(riga[idx['FVM M']]) : null,
        });
    }

    if (giocatori.length === 0) {
        return { errori: ['Nessun giocatore trovato nel listone.'] };
    }

    const ruoliInvalidi = giocatori.filter((g) => !RUOLI_VALIDI.includes(g.ruolo_classico));
    if (ruoliInvalidi.length > 0) {
        return { errori: [`Trovati ${ruoliInvalidi.length} giocatori con ruolo classico non valido (atteso P/D/C/A).`] };
    }

    const idsVisti = new Set();
    const duplicati = new Set();
    for (const g of giocatori) {
        if (idsVisti.has(g.id_listone)) duplicati.add(g.id_listone);
        idsVisti.add(g.id_listone);
    }
    if (duplicati.size > 0) {
        return { errori: [`Trovati id giocatore duplicati nel listone: ${[...duplicati].join(', ')}.`] };
    }

    return { giocatori };
}

module.exports = { parseListone, COLONNE_RICHIESTE };
