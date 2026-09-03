# ATMO backend v4 — scheduled home server

## What changed

- The former `run.mjs` is now `last-day-worked.mjs`.
- The new `run.mjs` runs these scripts sequentially:
  1. `last-day-worked.mjs`
  2. `generate-team-rep-gaps.mjs`
- The second script starts only after the first exits successfully.
- `server/index.mjs` schedules that sequence for 11:30 AM America/New_York every day.
- The server listens on `0.0.0.0` and supports exact Vercel origins through `CLIENT_ORIGIN`.
- `GET /api/health` reports server and automation status.
- `POST /api/automation/run` manually runs the sequence and requires `X-API-Key` or a Bearer token.

## Install and test

```powershell
cd C:\habit\atmoMatchups-backend-v4-home-server
copy .env.example .env
npm install
npm run run
npm run server
```

Health check:

```text
http://localhost:3001/api/health
```

## Vercel connection

The Vercel UI cannot reach localhost directly. Publish this local server through a secure HTTPS tunnel, such as Cloudflare Tunnel, and set the frontend's `VITE_API_URL` to that public hostname.

Example:

```text
VITE_API_URL=https://api.example.com
```

Set `CLIENT_ORIGIN` in this backend to the exact Vercel URL, without a trailing slash.

## Cloudflare Tunnel outline

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel login
cloudflared tunnel create atmo-api
cloudflared tunnel route dns atmo-api api.example.com
cloudflared tunnel run atmo-api
```

Configure the tunnel ingress to send `api.example.com` to `http://localhost:3001`.

The computer must remain powered on, awake, connected to the internet, and running both Node and the tunnel for the scheduled job and Vercel API access to work.
