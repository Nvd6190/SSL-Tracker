# SSL Certificate Manager

A React + TypeScript single-page application for tracking and managing SSL certificates across domains.

## Features

- **Certificate Overview** — dashboard with summary metrics (total, active, expired, due in 15/30/60/180 days, pending scan).
- **Priority alerts** — highlights the certificate that needs attention first.
- **Search & filter** — search by domain, owner, issuer, or tag; filter by renewal status.
- **Add Certificate** — add a domain and auto-scan its SSL certificate details (issuer, expiry, type).
- **CSV Import** — bulk-import domains from a CSV file with automatic SSL scanning.
- **Subdomain Scanner** — background subdomain discovery across all tracked domains.
- **Inline editing** — edit customer details, contact info, and remarks directly on certificate cards.
- **Re-scan / Refresh** — re-scan all certificates to update expiry and issuer data.
- **Backend sync** — optional Express + SQL Server backend for persistent storage.
- **Azure deployment** — Bicep infrastructure templates for App Service and Azure SQL.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite 7 |
| Backend (optional) | Node.js, Express, Tedious (SQL Server) |
| Infrastructure | Azure App Service, Azure SQL, Bicep |

## Local development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5173`. Without the backend server, it falls back to seeded sample data.

### Optional: start the backend

```bash
npm start          # Express API on port 8080
npm run scanner    # SSL scanner service on port 3456
```

## Project structure

```
src/              React frontend source
  App.tsx         Certificate Overview dashboard
  main.tsx        App shell, sidebar, routing
  SubdomainDiscovery.tsx  Subdomain Scanner page
  AddDomainModal.tsx      Add Certificate modal
  ImportModal.tsx         CSV Import modal
  data/certificates.ts    Seed data
server/           Express backend + SSL scanner
infra/            Azure Bicep deployment templates
```

## Available scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | TypeScript check + production build |
| `npm run preview` | Preview production build |
| `npm start` | Start Express backend server |
| `npm run scanner` | Start SSL scanner service |