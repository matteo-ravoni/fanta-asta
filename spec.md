# Fantalega — Specifiche del progetto

App per l'asta annuale del Fantacalcio tra amici. Un banditore tiene lo schermo host su un laptop, i partecipanti fanno i rilanci dal cellulare. Tutto su rete WiFi locale isolata, senza dipendenze da internet durante l'asta.

## 1. Architettura

- **Singolo container Docker** con dentro il server Node.js e SQLite. Un solo processo Node gestisce sia HTTP che WebSocket.
- **SQLite** come database, con il file su volume montato dall'esterno (`./data:/app/data`) per persistenza tra riavvii e stagioni.
- **Comunicazione real-time via WebSocket** (Socket.IO). Il server è l'unica fonte di verità.
- **Nessuna app da installare**: sia lo schermo host che gli 8 cellulari sono browser che aprono un URL locale (`http://<ip-laptop>:3000`). L'accesso avviene via QR code mostrato sullo schermo host.
- **Rete**: WiFi locale isolata (hotspot del laptop o mini router dedicato). Nessuna connessione a internet richiesta durante l'asta.
- **Nessun ruolo di admin separato**: l'host è uno dei partecipanti, con due sessioni concorrenti (una vista host sul laptop + una vista mobile sul suo cellulare come tutti gli altri). Il server non distingue tecnicamente il partecipante-host dagli altri: sa solo che c'è "un client host" e "N client partecipanti".

## 2. Stack tecnico

- **Backend**: Node.js 20 + Express + Socket.IO.
- **Database**: SQLite (better-sqlite3 o simile).
- **Frontend**: pagine HTML statiche servite dal server Node. Vanilla JS o React lato client — a scelta di Claude Code, purché senza build step complicati. Stack semplice, single-page dove possibile.
- **Container**: Docker singolo. `Dockerfile` + `docker-compose.yml` con:
  - porta 3000 pubblicata (`ports: - "3000:3000"`)
  - volume `./data:/app/data` per SQLite
  - `restart: unless-stopped`
- **Parsing listone**: libreria per leggere file `.xlsx` (es. `xlsx` / SheetJS).
- **Export finale**: file CSV + Excel + dump JSON completo dell'asta.

## 3. Regolamento dell'asta

### Configurazione iniziale

Modificabile solo con asta in stato `non_iniziata`. Tutti i campi:

- **Numero di partecipanti**: 2-20 (default 8).
- **Nomi delle squadre**: uno per partecipante, inserito nella pagina di configurazione.
- **Crediti per partecipante**: numero intero (default 500).
- **Tipo di asta**: `classica` o `mantra`.
- **Composizione rosa**:
  - Se `classica`: 4 numeri separati per P, D, C, A (default 3-8-8-6).
  - Se `mantra`: solo 2 numeri — totale giocatori e numero portieri. Nessun vincolo sugli altri ruoli.
- **Ordine di uscita giocatori**: `casuale` / `per_ruolo` / `alfabetico`.
- **Ordine dei partecipanti** (per UI e log): generato random al salvataggio della configurazione, poi fisso.
- **Upload listone** (`.xlsx`): il file deve avere le colonne `Id`, `R`, `RM`, `Nome`, `Squadra`, `Qt.A`, `Qt.A M`, `FVM`, `FVM M`. Se mancano colonne, upload rifiutato con errore chiaro. Il file contiene entrambe le modalità (classica e mantra) — la scelta del tipo di asta determina quali colonne il server usa (`R` + `Qt.A`/`FVM` per la classica, `RM` + `Qt.A M`/`FVM M` per la mantra).
- **Blocco upload**: appena l'asta passa a `in_corso`, l'endpoint di upload va disabilitato lato server, non solo nella UI.

### Meccanica dei rilanci

- Base d'asta: 1 credito. **Deve esserci almeno un'offerta di apertura** perché il giocatore sia messo all'asta.
- Rilanci **liberi** (importo arbitrario > offerta corrente).
- **Riserva minima obbligatoria** (validata lato server): un partecipante non può puntare più di `crediti_residui - (slot_rosa_rimanenti - 1)`. Deve sempre restare almeno 1 credito per ogni slot ancora da riempire. Se un rilancio viola la riserva, viene rifiutato con messaggio esplicito.
- **Countdown 5-4-3-2-1**: gestito dal server con **timestamp assoluto** (`scadenza = now + 5s`) ribroadcastato ai client via WebSocket. I client visualizzano il countdown localmente confrontando il timestamp con l'orologio del proprio dispositivo. Il timer parte al primo rilancio (non all'apparire del giocatore) e si resetta a 5 ad ogni nuovo rilancio.
- **Il countdown è informativo, non ghigliottina**: quando arriva a zero l'asta NON si chiude automaticamente. L'unico gesto che chiude l'asta di un giocatore è il click dell'host su "Assegna".

### Rilanci dopo lo zero del countdown

Regime speciale quando il countdown è a zero:

- Ogni rilancio che arriva viene messo in stato **`in_attesa_host`**. Non aggiorna automaticamente l'offerta corrente.
- Sull'host appare un pannello con i rilanci in sospeso: per ognuno, pulsanti **Accetta** o **Rifiuta**.
- Se accettato: il rilancio diventa effettivo, l'offerta corrente si aggiorna, il countdown riparte da 5.
- Se rifiutato: il rilancio viene scartato, l'offerta resta com'era.
- Sul cellulare del proponente compare "In attesa di approvazione…" finché l'host non decide.
- I rilanci in sospeso arrivati ravvicinati vengono mostrati in coda in ordine di arrivo.
- **Nessun safeguard sul conflitto di interessi dell'host** (l'host è uno dei partecipanti e potrebbe rifiutare rilanci di avversari). Fiducia reciproca + log admin visibile a tutti.

### Stati delle offerte nel database

- `accettata_automatica` — rilancio arrivato prima dello zero, applicato senza intervento host.
- `in_attesa_host` — rilancio arrivato dopo lo zero, in attesa di decisione host.
- `accettata_host` — approvato dall'host.
- `rifiutata_host` — scartato dall'host.

### Stati dei giocatori

- `da_bandire` — nel listone, non ancora messo in asta.
- `in_asta` — attualmente sullo schermo host.
- `assegnato` — venduto a un partecipante.
- `saltato` — passato senza vendita, da riproporre a fine giro.

### Stati dell'asta complessiva

- `non_iniziata` — configurazione modificabile.
- `in_corso` — asta attiva.
- `sospesa` — messa in pausa dall'host o da disconnessione partecipante.
- `conclusa` — chiusa manualmente dall'host, dati congelati.

### Gestione ruoli mantra multipli

Nel listone molti giocatori hanno ruoli mantra multipli (es. `Dd;Dc`, `T;A`). **Non si sceglie il ruolo al momento dell'acquisto**: il giocatore entra semplicemente nella rosa, purché non sia un portiere se lo slot portieri è già pieno. La composizione rosa mantra ha solo due vincoli hard: totale giocatori e portieri.

### Ordine di uscita e coda giocatori

- La coda dei giocatori da bandire viene calcolata al momento del salvataggio della configurazione (secondo il criterio scelto: casuale, per ruolo, alfabetico).
- **La coda futura NON è mai esposta via WebSocket ai client**. Nessun cliente vede in anticipo chi sta per uscire, nemmeno l'host. Il server manda solo il giocatore correntemente in asta.
- **Nessuna lista "prossimi giocatori" nella UI**, in nessuna vista.

### Fine giro principale e riproposizione dei saltati

- Quando l'host clicca "Salta", il giocatore passa in stato `saltato`. Nessun timeout automatico: solo l'host decide quando saltare.
- Alla fine del giro principale (tutti i giocatori del listone passati), il server ripropone **automaticamente** i giocatori saltati **uno dopo l'altro nell'ordine in cui erano stati saltati**. L'host non vede la lista dei saltati, li scopre uno alla volta come nel giro principale.
- Un giocatore rifiutato di nuovo torna in coda. Cicli possibili finché finiscono o l'host chiude l'asta manualmente.

## 4. Comportamento operativo

### Login partecipanti

- Nessuna password. Al primo accesso al link, il partecipante sceglie il nome della propria squadra da una lista degli 8 nomi inseriti in configurazione. Da quel momento è associato a quella squadra per tutta la sessione.
- **Blocca nuovi accessi**: l'host può chiudere gli accessi una volta che tutti sono dentro. Nessuno può più entrare.

### Disconnessione partecipante

- Timeout WebSocket: **5 secondi** di silenzio → il server considera il cellulare offline.
- Se l'asta era in corso su un giocatore, viene messa **automaticamente in pausa** (`sospesa`). Sullo schermo host appare un banner tipo _"In attesa di [nome] (disconnesso)"_.
- L'host può forzare la ripresa anche senza aspettare il rientro.
- Alla riconnessione automatica: ripresa immediata dello stato esatto.

### Sospendi/Riprendi

- Pulsante sull'host, sempre disponibile durante l'asta.
- La sospensione congela countdown e blocca nuovi rilanci finché non si riprende.

### Gestione errori (host-only)

Tutte queste azioni sono disponibili solo sull'host, con conferma:

- **Annulla ultima assegnazione**: il giocatore torna in stato `in_asta`, crediti e slot ripristinati.
- **Modifica assegnazione a posteriori**: cambia squadra vincitrice, prezzo, o giocatore. Serve solo per correggere errori.
- **Svincolo giocatore assegnato** (host-only): il giocatore torna nel listone come `da_bandire`, i crediti tornano al partecipante.
- **Reset a due livelli**:
  - `reset rose` — svuota tutte le rose e le offerte, ma tiene configurazione, listone, partecipanti.
  - `reset completo` — torna tutto a zero.

### Log admin

- Tutte le operazioni dell'host (assegnazioni, svincoli, modifiche, reset, accetta/rifiuta) vanno in un log con timestamp e dati.
- Ogni giocatore ha uno **storico offerte** consultabile: sequenza completa dei rilanci che hanno portato al prezzo finale, con partecipante, importo, timestamp, stato.

### Rilanci sul cellulare

- Pulsanti fissi: **+1**, **+5**, **+10**.
- Campo libero per offerta manuale (qualsiasi importo > offerta corrente).
- **Nessuna conferma** su rilanci alti: se sbaglia, l'host annulla dal log.

### Fine asta

- **Sempre manuale**: pulsante "Chiudi asta ed esporta" sull'host. Nessuna chiusura automatica anche quando tutte le rose sono complete.
- Al click:
  - Stato asta → `conclusa`. Dati congelati.
  - Server genera 3 file scaricabili: **CSV rose** (formato compatibile app Leghe Fantacalcio), **Excel completo**, **dump JSON dell'asta** (formato backup/replay).

## 5. Viste

### Schermo host (laptop, tab "Stanza d'asta")

- Giocatore corrente in asta (nome, ruolo, squadra, quotazione).
- Offerta più alta corrente + squadra in testa.
- Countdown visibile.
- Rose complete di tutti i partecipanti (crediti residui + slot occupati per ruolo).
- Pannello **rilanci in attesa di approvazione** (post-zero countdown).
- Pulsanti sempre disponibili: **Assegna** / **Salta** / **Sospendi**/Riprendi.
- Accesso al log admin e azioni di correzione (annulla ultima, modifica, svincola).
- **Mai la lista dei "prossimi giocatori"**, in nessun momento.

### Vista mobile partecipante

- Nome squadra + crediti residui in evidenza.
- Rosa personale in costruzione (per ruolo).
- Giocatore corrente in asta.
- Offerta più alta corrente + chi è in testa.
- Countdown.
- Pulsanti rilancio (+1, +5, +10, campo manuale).
- Feedback stato rilancio: "In attesa di approvazione…" quando pertinente.

### Pagina Configurazione (solo prima dell'inizio)

Campi da configurare (dettagli sezione 3): partecipanti, nomi squadre, crediti, tipo asta, composizione rosa, ordine uscita, upload listone. Salvataggio unico.

### Pagina Listone

Tabella dei giocatori caricati: nome, squadra, ruolo classico, ruolo mantra, quotazione, FVM, stato. Filtri per ruolo + ricerca testuale. Giocatori ceduti mostrati barrati.

### Pagina Collegamento

Momento tra "salva configurazione" e "inizio asta". Sullo schermo host:

- QR code grande + URL testuale con pulsante copia.
- Info di rete (nome Wi-Fi + codice sessione).
- Lista degli 8 partecipanti con stato (verde = collegato, grigio = in attesa) e contatore "N/8 collegati".
- Toggle "Blocca nuovi accessi".
- Pulsante "Inizia asta" (attivo solo quando il toggle di blocco è on).

## 6. Design system

- **Palette** (dai mockup Claude Design):
  - Sfondo principale: `#241454` (viola scuro)
  - Card: `#341c6b` (viola più chiaro)
  - Input/sfondi profondi: `#1c0f3f`
  - Accento primario: `#1ee8a6` (verde acqua)
  - Testo su accento: `#0a2e22`
  - Testo principale: `#f4f1fb`
  - Testo secondario: `rgba(244,241,251,0.62)`
  - Testo terziario: `rgba(244,241,251,0.5)`
  - Bordi: `rgba(244,241,251,0.22)`
- **Font**: Archivo (Google Fonts), weight 400/600/800. Titoli sempre weight 800 con `letter-spacing: -0.015em`.
- **Stile**: angoli squadrati (nessun border-radius), separatori sottili, sezioni divise da linee 2px.
- **Tono copy**: amichevole, italiano informale ("Prepariamo l'asta!", "Chi è a bordo?", "Si fa sul serio!", "Dai, carica il listone!").
- **Ruoli con colori distinti**:
  - Portiere: `#bff5e2` background, `#0d3b2e` testo
  - Difensore: `#7ee7c4` background, `#0d3b2e` testo
  - Centrocampista: `#35d9a3` background, `#0a2e22` testo
  - Attaccante: `#1ee8a6` background, `#0a2e22` testo

## 7. Struttura del repo suggerita

```
fantalega-asta/
├── SPECS.md                     # questo file
├── Dockerfile
├── docker-compose.yml
├── package.json
├── server/
│   ├── server.js                # bootstrap Express + Socket.IO
│   ├── auction.js               # stato asta, timer, validazione rilanci
│   ├── db.js                    # accesso SQLite + migrazioni
│   ├── listone.js               # parsing xlsx
│   └── export.js                # generazione CSV/Excel/JSON finali
├── public/
│   ├── host.html                # dashboard schermo host
│   ├── mobile.html              # vista cellulare partecipante
│   ├── config.html              # pagina configurazione
│   ├── listone.html             # pagina consultazione listone
│   ├── join.html                # scelta squadra al primo accesso
│   └── assets/                  # css, js client, font Archivo
├── data/                        # volume SQLite (persistente, .gitignore)
├── mockups/                     # HTML esportati da Claude Design (reference)
└── uploads/                     # cartella temp per file listone caricati
```

## 8. Piano di implementazione consigliato

1. **Schema SQLite completo** (tabelle, colonne, tipi, vincoli, indici) — fondamento su cui appoggia tutto il resto.
2. **Dockerfile + docker-compose + package.json** — scheletro che gira davvero con `docker compose up` anche se il server è vuoto.
3. **Server minimo** — Express che serve pagine statiche + Socket.IO connesso ma senza logica di gioco.
4. **Pagina di configurazione end-to-end** — inclusi caricamento listone, parsing xlsx, validazione, salvataggio nel DB, gate "asta non iniziata".
5. **Pagina di collegamento** — QR, lista partecipanti, blocco accessi, gestione connessioni Socket.IO.
6. **Motore d'asta lato server** — coda giocatori, gestione offerte, countdown con timestamp, riserva minima, stati offerta, disconnessioni, sospensione.
7. **Vista mobile partecipante** — rilanci, feedback stato, aggiornamenti real-time.
8. **Vista host** — dashboard rose, pannello rilanci in sospeso, pulsanti Assegna/Salta/Sospendi.
9. **Azioni admin** — annulla, modifica, svincola, reset, log.
10. **Riproposizione saltati + fine asta + export**.

## 9. Riferimenti nel repo

- `mockups/` — HTML esportati da Claude Design, usare come riferimento visivo esatto per stili e layout delle quattro schermate.
- `uploads/Quotazioni_Fantacalcio_Stagione_2026_27.xlsx` — file di esempio del listone Mantra reale, per test del parser. 495 giocatori attivi (60 P, 175 D, 173 C, 87 A), foglio "Ceduti" con 6 giocatori.
