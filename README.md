# Planest

Planest e una PWA installabile per pianificazione ad albero:

- `Priorita (macro categoria)` -> contiene `Voci`
- `Voce` -> contiene `Azioni`
- `Azione` -> ha percentuale di completamento (0-100)

Il progresso e automatico:

- progresso `Voce` = media % delle azioni
- progresso `Macro categoria` = media % delle voci

## Stack scelto

- Frontend: React + TypeScript + Vite
- Offline-first: IndexedDB (Dexie)
- Backend cloud gratuito consigliato: **Supabase**
- PWA: `vite-plugin-pwa`

Per questo caso Supabase e la scelta migliore rispetto a Firebase perche:

- modello relazionale naturale per categoria/voce/azione
- SQL utile per report settimanali futuri
- storage allegati integrabile in modo semplice
- buon piano free per MVP

## Funzioni implementate

- PWA installabile (manifest + service worker)
- Macro categorie con owner e colore
- Voci e azioni con avanzamento %
- Calendario con:
  - attivita ricorrenti (giornaliera/settimanale/mensile)
  - reminder multipli
  - colori personalizzabili
  - allegati (in MVP salvati come data URL)
- Filtri per categoria
- Riepilogo settimanale
- Alert su attivita incomplete
- Modalita offline per funzioni base
- Sync automatica al ritorno online

## Avvio locale

```bash
npm install
npm run dev
```

Build produzione:

```bash
npm run build
npm run preview
```

## Setup Supabase

1. Crea un progetto su Supabase.
2. Esegui `supabase/schema.sql` nel SQL Editor.
3. Crea `.env` da `.env.example`:

```bash
cp .env.example .env
```

4. Inserisci URL e anon key del progetto.
5. Riavvia `npm run dev`.

Se le variabili non sono impostate, Planest funziona in modalita locale offline.

## Push reminder reali (PWA)

Per avere notifiche push vere (anche con app in background), usa Supabase Edge Functions:

1. Genera VAPID keys (una volta sola), ad esempio con `web-push`.
2. Frontend env (`.env`):
   - `VITE_VAPID_PUBLIC_KEY=...`
3. Supabase secrets per Edge Function:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` (es. `mailto:you@example.com`)
   - `CRON_SECRET` (consigliato)
4. Esegui `supabase/schema.sql` aggiornato (crea `push_subscriptions` e `push_dispatch_log`).
5. Deploy function:
   - `supabase functions deploy send-reminders`
6. Schedula chiamata ogni minuto (Cron + pg_net) verso:
   - `/functions/v1/send-reminders`
   - header `x-cron-secret: <CRON_SECRET>`

La function invia push dei reminder evento e, al click, l'app apre Calendario sul giorno/evento.

## Note MVP

- Le notifiche browser funzionano se l'utente concede permessi.
- Gli allegati in MVP sono salvati localmente/base64; in produzione conviene usare Supabase Storage.
- Le policy RLS nel file SQL sono volutamente aperte per sviluppo: da chiudere prima del rilascio.

## Prossime ottimizzazioni consigliate

- autenticazione utente + RLS per tenant/team
- sync incrementale con `updated_at` e conflitti risolti lato server
- reminder push reali (service worker + Web Push)
- calendario con drag&drop e vista mese/settimana avanzata
- allegati su bucket Supabase con URL firmate
