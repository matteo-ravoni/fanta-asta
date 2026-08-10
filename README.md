# Fantalega — Asta Fantacalcio

App per l'asta annuale del Fantacalcio tra amici. Un banditore (host) tiene lo schermo su un laptop, i partecipanti fanno i rilanci dal cellulare. Tutto in tempo reale via WebSocket, pensato per girare su una rete WiFi locale senza dipendere da internet durante l'asta.

## Funzionalità

- Asta live in tempo reale (Socket.IO) tra schermo host e cellulari dei partecipanti.
- Modalità **classica** (slot per ruolo P/D/C/A) o **mantra** (totale giocatori + portieri), a scelta in fase di configurazione.
- Countdown ad ogni rilancio, con **durata configurabile in secondi**.
- Riserva minima di crediti validata lato server (non si può restare senza crediti per gli slot rimanenti).
- Rilanci arrivati dopo lo zero del countdown messi in coda per l'approvazione manuale dell'host.
- Pannello admin: annulla ultima assegnazione, modifica assegnazione, svincola giocatore, reset rose/reset completo, log completo delle azioni.
- Sospensione automatica dell'asta se un partecipante si disconnette, con ripresa automatica al rientro.
- Riproposizione automatica dei giocatori saltati a fine giro.
- Chiusura asta bloccata finché le rose di tutte le squadre non sono complete.
- Export finale: CSV rose (formato compatibile app Leghe Fantacalcio), Excel completo, dump JSON dell'intera asta.
- Collegamento partecipanti via QR code, senza installare nulla né digitare indirizzi.

## Stack tecnico

- **Backend**: Node.js 20 + Express + Socket.IO + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3).
- **Frontend**: Angular (SPA con router), servito come build statica dal backend.
- **Database**: SQLite su file, persistito su volume Docker (`./data`).
- **Container**: un solo container Docker (build multi-stage: compila il frontend Angular, poi lo serve da un'immagine Node slim insieme all'API).

## Avvio rapido (Docker)

```bash
docker compose up -d --build
```

L'app è raggiungibile su `http://localhost:3000` sul PC host, e su `http://<ip-locale-del-pc>:3000` dagli altri dispositivi sulla stessa rete.

**Importante**: ogni volta che si modifica il codice va rifatta la build — il container non si aggiorna da solo con i soli cambi ai file sorgente:

```bash
docker compose up -d --build
```

I dati (configurazione, listone, rose, log) restano nel volume `./data` tra un riavvio e l'altro del container.

## Sviluppo senza Docker

Backend (porta 3000):

```bash
npm install
npm start
```

Frontend, in una finestra separata, per lo sviluppo con hot reload (proxy automatico di `/api` e `/socket.io` verso il backend su `:3000`, vedi `frontend/proxy.conf.json`):

```bash
cd frontend
npm install
npm start
```

## Collegare i partecipanti da telefono

1. Sul PC host, apri l'app usando l'**indirizzo IP di rete**, non `localhost` (es. `http://192.168.1.67:3000`) — da lì la pagina di collegamento genera un QR code che punta all'indirizzo giusto.
2. Assicurati che il firewall di Windows non blocchi la porta 3000 sulla rete in uso (in particolare se la rete Wi-Fi risulta categorizzata come "Pubblica").
3. Gli altri dispositivi devono essere sulla stessa rete Wi-Fi: scansionano il QR e sono dentro, nessuna app o digitazione richiesta.

Per accedere da fuori dalla rete locale (es. partecipanti non fisicamente presenti), si può esporre temporaneamente il servizio con un tunnel, ad esempio `tailscale funnel 3000`, senza aprire porte sul router.

## Struttura del repo

```
asta fantacalcio/
├── Dockerfile                 # build multi-stage: frontend Angular + server Node
├── docker-compose.yml
├── package.json                # dipendenze del server
├── server/
│   ├── server.js                # bootstrap Express + Socket.IO
│   ├── auction.js               # stato asta, countdown, validazione rilanci
│   ├── admin.js                  # azioni host: annulla, modifica, svincola, reset, log
│   ├── config.js                 # configurazione asta + parsing/salvataggio listone
│   ├── listone.js                # parsing del file .xlsx
│   ├── export.js                 # generazione CSV/Excel/JSON finali
│   ├── db.js                     # apertura SQLite + migrazioni leggere
│   └── schema.sql                # schema completo del database
├── frontend/                   # SPA Angular (pagine: config, collegamento, stanza, mobile, listone, join)
├── data/                        # volume SQLite persistente (ignorato da git)
├── mockups/                     # riferimento visivo (HTML esportati da Claude Design)
└── spec.md                      # specifiche funzionali complete del progetto
```
