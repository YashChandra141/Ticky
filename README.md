# Ticky — local-first invoicing with a local AI copilot

Ticky is a single-user invoicing app that runs entirely on your machine: create, issue, track and
export invoices, record payments, and let a **local LLM (via [Ollama](https://ollama.com))** draft
invoices from plain English. Nothing leaves your computer.

It runs as a normal web app (`bun dev` / `bun run start`) and as a **Windows desktop app**
(Electron shell, NSIS installer). The same codebase can also be deployed as a public, disposable
demo on Render.

## Features

- **Dashboard** — outstanding / overdue / paid totals, searchable, status-filtered invoice ledger, CSV export
- **Invoice lifecycle** — draft → issued → void with the freeze rules that matter: items and the customer block lock when an invoice is issued, and an `issuedSnapshot` freezes customer + totals at that moment forever
- **Payments** — record payments against issued invoices; `paid`, `partially_paid` and `overdue` are always **derived** from payments and the due date, so they can never drift
- **Integer money** — all amounts are stored and computed as integer cents; tax is rounded half-up exactly once; floats only exist at the input/display edges
- **AI copilot** (Ollama, structured output):
  - *Draft* — `"Invoice for Acme — 12 hours consulting at $150/hr, 8% tax, net 30"` → editable invoice; the copilot **asks** when it can't infer a price or customer instead of inventing zeros
  - *Extract* — paste an email, get line items and customer details
  - *Polish* — one click to rewrite notes and terms professionally
  - Customer matching links drafts to saved clients (exact matches auto-link, fuzzy hits ask)
- **Model picker** — switch between your installed Ollama models live (default: `gemma2:2b`)
- **PDF** — server-generated with pdf-lib (native save dialog in the desktop app) plus a print-optimized page
- **SQLite storage** — one file, WAL mode, `VACUUM INTO` backups, one-click restore with validation
- **Item catalog** — every line item you invoice is remembered for autocomplete with its last price

## Architecture

```
Electron main ──spawns──▶ Next standalone server (127.0.0.1) ──▶ SQLite (userData/data)
      │  IPC: save dialogs, file reveal, backup orchestration           ▲
      ▼                                                                 │
Renderer (sandboxed) ──────── HTTP /api/* ──────────────────────────────┘
                                     └──▶ Ollama (localhost:11434, structured output)
```

The renderer never touches Node or the database — it talks HTTP to its own local server. Native
work (save dialogs, revealing files, restore-from-file) goes through a 6-channel allow-listed IPC
bridge validated in the main process. In a plain browser the same UI falls back to normal
downloads, so the web build and the hosted demo work unchanged.

## Prerequisites

- [Bun](https://bun.sh) 1.1+ and Node 24+ (for `node:sqlite`)
- [Ollama](https://ollama.com/download) for the AI copilot, with one model pulled:

  ```bash
  ollama pull gemma2:2b
  ```

  Recommended: `gemma2:2b` (default), `qwen2.5:3b` (stronger structured output).

## Run it (web)

```bash
bun install
ollama serve      # if it isn't running yet
bun dev
```

Open http://localhost:3000. The database starts empty; the dashboard offers a one-time business
setup (name + currency).

## Configuration (`.env.local`)

| Variable          | Default                  | Meaning                                        |
| ----------------- | ------------------------ | ---------------------------------------------- |
| `OLLAMA_BASE_URL` | `http://localhost:11434`| Where the Ollama server listens                 |
| `OLLAMA_MODEL`    | `gemma2:2b`              | Fallback model when none is chosen in Settings  |
| `TICKY_DATA_DIR`  | `./data`                 | Where the SQLite database lives                 |

The active model is stored in the database and can be switched from the copilot panel or Settings
at any time.

## Data, backup and privacy

Everything lives in one SQLite file:

- Web/dev: `./data/ticky.db`
- Desktop: `%APPDATA%/Ticky/data/ticky.db` (plus `backups/`)

Settings → **Data & backup**: back up now (`VACUUM INTO` snapshot), restore any backup (validated
before swapping; the current file is always kept aside), or restore from an arbitrary `.db` file
via a native picker. A corrupt database is moved aside automatically and a fresh one is created.

**Privacy:** in the desktop app and local web mode, prompts and invoices never leave your machine
— the copilot talks to your own Ollama. In the hosted demo, anything you type passes through
Render's servers (see below).

## Desktop app (Windows)

```bash
bun run dev:desktop   # next dev + Electron shell against it
bun run build:desktop # Next standalone + staged server + compiled shell
bun run dist:win      # dist-electron/Ticky-Setup-<version>.exe (NSIS)
```

The packaged app spawns the server on `127.0.0.1` only, with `TICKY_DATA_DIR` under the OS user
data directory. Save dialogs for PDF/CSV, reveal-in-folder and restore-from-file are native.

## Hosted demo (optional)

`render.yaml` deploys the same app as a public sandbox on Render (Bun runtime, free plan,
`TICKY_MODE=demo`). The honest boundaries:

- The demo database lives in `/tmp` and **resets** whenever Render recycles the service — it seeds itself with sample data on boot.
- **AI is off in the demo by default** (no Ollama in the cloud container); it only activates if the owner sets `OLLAMA_BASE_URL` to their own reachable Ollama server in Render's dashboard.
- Demo guardrails: AI routes are rate-limited (~20 requests/min per IP) and every write endpoint caps request body size.
- No secrets belong in `render.yaml`; set anything sensitive in Render's dashboard.

## Development

```bash
bun run test      # Vitest — domain, DB, AI adapter (97 tests)
bun run lint      # eslint
bun run build     # Next production build
```

Money rules worth knowing before contributing: amounts are integer minor units everywhere behind
the UI (`quantityMilli`, `unitPriceMinor`, `taxRateBps`), computed via `src/lib/domain/`, and
derived statuses (`paid`/`partially_paid`/`overdue`) are never stored.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui (Base UI) · Zod · pdf-lib ·
`node:sqlite` · Electron 44 · electron-builder · Bun · Ollama

## License note

Ticky itself is yours to use and modify. The default AI model is Google's **Gemma 2** — check the
[Gemma Terms of Use](https://ai.google.dev/gemma/terms) before redistributing model weights with
the app; Ticky never downloads or bundles models automatically.
