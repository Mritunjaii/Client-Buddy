# Client Buddy

Privacy-first WhatsApp client intelligence dashboard for freelancers and agencies.

## Overview
Client Buddy turns bursts of fragmented WhatsApp client messages into structured, contextual client briefs with actionable requirements, deadlines, suggested manual reply drafts, and reminders.

### Key Architectural Pillars:
1. **Sliding-Window Batching Engine:**
   - Messages from the same chat reset a quiet inactivity window (`flushAt`).
   - Hard upper limit (`maxFlushAt`) prevents infinite starvation.
   - Atomically claimed by worker using lease locks (`findOneAndUpdate`).
2. **Strict Privacy & Controlled Retention:**
   - Local open-weight inference (Gemma via Ollama).
   - Raw source messages retained for 7 days with MongoDB TTL cleanup.
   - Summaries and reminder logs maintained permanently.
   - No WhatsApp messages are ever automatically sent (Copy-only reply drafts).

## Monorepo Layout
- `packages/shared`: Shared Zod validation schemas and TypeScript types.
- `apps/server`: Node.js + Express + Socket.IO backend, BatchManager, BatchWorker, and Ollama adapter.
- `apps/web`: Next.js + Tailwind CSS two-column dashboard with simulation burst controls and source inspector.

## Running Locally

### 1. Start MongoDB
Ensure MongoDB is running locally on port 27017:
```bash
# Windows
Get-Service -Name MongoDB
```

### 2. Start the Backend Worker
```bash
npm run dev:server
```
Runs at `http://127.0.0.1:3001`.

### 3. Start the Next.js Dashboard
```bash
npm run dev:web
```
Available at `http://localhost:3000`.
