-- Fantalega — schema SQLite completo
-- Le tabelle "singleton" (configurazione, stato_asta) usano id=1 fisso,
-- imposto con CHECK, per garantire una sola riga senza bisogno di logica applicativa.

PRAGMA foreign_keys = ON;

-- ============================================================
-- CONFIGURAZIONE (singleton, modificabile solo con stato_asta = 'non_iniziata')
-- ============================================================
CREATE TABLE configurazione (
    id                      INTEGER PRIMARY KEY CHECK (id = 1),
    numero_partecipanti     INTEGER NOT NULL CHECK (numero_partecipanti BETWEEN 2 AND 20),
    crediti_iniziali        INTEGER NOT NULL DEFAULT 500 CHECK (crediti_iniziali > 0),
    tipo_asta               TEXT NOT NULL CHECK (tipo_asta IN ('classica', 'mantra')),

    -- classica: slot per ruolo. mantra: solo totale + portieri (vedi CHECK incrociato in fondo alla tabella).
    slot_portieri           INTEGER NOT NULL CHECK (slot_portieri > 0),
    slot_difensori          INTEGER CHECK (slot_difensori > 0),
    slot_centrocampisti     INTEGER CHECK (slot_centrocampisti > 0),
    slot_attaccanti         INTEGER CHECK (slot_attaccanti > 0),
    slot_totale_mantra      INTEGER CHECK (slot_totale_mantra > 0),

    ordine_uscita           TEXT NOT NULL CHECK (ordine_uscita IN ('casuale', 'per_ruolo', 'alfabetico')),
    creata_il               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    aggiornata_il           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    -- vincolo incrociato: garantisce che siano popolati solo i campi coerenti col tipo_asta
    CHECK (
        (tipo_asta = 'classica'
            AND slot_difensori IS NOT NULL
            AND slot_centrocampisti IS NOT NULL
            AND slot_attaccanti IS NOT NULL
            AND slot_totale_mantra IS NULL)
        OR
        (tipo_asta = 'mantra'
            AND slot_totale_mantra IS NOT NULL
            AND slot_difensori IS NULL
            AND slot_centrocampisti IS NULL
            AND slot_attaccanti IS NULL)
    )
);

-- ============================================================
-- PARTECIPANTI
-- ============================================================
CREATE TABLE partecipanti (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    nome_squadra        TEXT NOT NULL UNIQUE,
    ordine              INTEGER NOT NULL UNIQUE,   -- ordine fisso generato al salvataggio configurazione
    crediti_residui     INTEGER NOT NULL CHECK (crediti_residui >= 0),
    token               TEXT UNIQUE,               -- assegnato al primo accesso (scelta nome squadra); NULL = non ancora reclamato
    creato_il           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ============================================================
-- GIOCATORI (listone)
-- ============================================================
CREATE TABLE giocatori (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    id_listone              INTEGER NOT NULL UNIQUE,   -- colonna "Id" del file xlsx
    nome                    TEXT NOT NULL,
    squadra_reale           TEXT NOT NULL,
    ruolo_classico          TEXT NOT NULL CHECK (ruolo_classico IN ('P', 'D', 'C', 'A')),
    ruolo_mantra            TEXT NOT NULL,             -- stringa grezza, es. "Dd;Dc"
    quotazione_classica     INTEGER NOT NULL CHECK (quotazione_classica >= 0),
    quotazione_mantra       INTEGER NOT NULL CHECK (quotazione_mantra >= 0),
    fvm_classica            INTEGER,
    fvm_mantra              INTEGER,
    stato                   TEXT NOT NULL DEFAULT 'da_bandire'
                                CHECK (stato IN ('da_bandire', 'in_asta', 'assegnato', 'saltato')),
    ordine_uscita           INTEGER NOT NULL UNIQUE,   -- posizione nella coda calcolata al salvataggio configurazione
    ordine_saltato          INTEGER UNIQUE,            -- valorizzato quando saltato: ordine di riproposizione a fine giro
    creato_il               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_giocatori_stato ON giocatori(stato);
CREATE INDEX idx_giocatori_ordine_uscita ON giocatori(ordine_uscita);
CREATE INDEX idx_giocatori_ordine_saltato ON giocatori(ordine_saltato);

-- ============================================================
-- ASSEGNAZIONI (stato attuale delle rose)
-- ============================================================
CREATE TABLE assegnazioni (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    giocatore_id        INTEGER NOT NULL UNIQUE REFERENCES giocatori(id),
    partecipante_id     INTEGER NOT NULL REFERENCES partecipanti(id),
    prezzo              INTEGER NOT NULL CHECK (prezzo > 0),
    assegnato_il        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_assegnazioni_partecipante ON assegnazioni(partecipante_id);

-- ============================================================
-- OFFERTE (storico completo di ogni rilancio)
-- ============================================================
CREATE TABLE offerte (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    giocatore_id        INTEGER NOT NULL REFERENCES giocatori(id),
    partecipante_id     INTEGER NOT NULL REFERENCES partecipanti(id),
    importo             INTEGER NOT NULL CHECK (importo > 0),
    stato               TEXT NOT NULL CHECK (stato IN (
                            'accettata_automatica',
                            'in_attesa_host',
                            'accettata_host',
                            'rifiutata_host'
                        )),
    creata_il           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- copre sia lo storico offerte per giocatore sia il pannello host dei rilanci in attesa
CREATE INDEX idx_offerte_giocatore_stato_creata ON offerte(giocatore_id, stato, creata_il);

-- ============================================================
-- STATO_ASTA (singleton, runtime — persistito per intero per sopravvivere a crash/riavvio)
-- ============================================================
CREATE TABLE stato_asta (
    id                          INTEGER PRIMARY KEY CHECK (id = 1),
    stato                       TEXT NOT NULL DEFAULT 'non_iniziata'
                                    CHECK (stato IN ('non_iniziata', 'in_corso', 'sospesa', 'conclusa')),
    giocatore_corrente_id       INTEGER REFERENCES giocatori(id),
    offerta_corrente            INTEGER,
    partecipante_in_testa_id    INTEGER REFERENCES partecipanti(id),
    countdown_scadenza          TEXT,               -- timestamp assoluto ISO8601; NULL = nessun countdown attivo
    accessi_bloccati            INTEGER NOT NULL DEFAULT 0 CHECK (accessi_bloccati IN (0, 1)),
    partecipante_disconnesso_id INTEGER REFERENCES partecipanti(id),  -- per ricostruire il banner dopo un riavvio
    aggiornato_il               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO stato_asta (id, stato) VALUES (1, 'non_iniziata');

-- ============================================================
-- LOG_ADMIN
-- ============================================================
CREATE TABLE log_admin (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    creato_il           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    tipo_azione         TEXT NOT NULL CHECK (tipo_azione IN (
                            'assegna',
                            'salta',
                            'annulla_assegnazione',
                            'modifica_assegnazione',
                            'svincola',
                            'accetta_rilancio',
                            'rifiuta_rilancio',
                            'sospendi',
                            'riprendi',
                            'reset_rose',
                            'reset_completo',
                            'blocca_accessi',
                            'sblocca_accessi',
                            'inizia_asta',
                            'chiudi_asta'
                        )),
    giocatore_id        INTEGER REFERENCES giocatori(id),
    partecipante_id     INTEGER REFERENCES partecipanti(id),
    dettagli            TEXT   -- JSON libero coi dati specifici dell'azione
);

CREATE INDEX idx_log_admin_creato_il ON log_admin(creato_il);
