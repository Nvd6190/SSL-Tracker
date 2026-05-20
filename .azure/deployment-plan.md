# Deployment Plan — SSL Certificate Tracking App

**Status:** Ready for Validation

## Overview
Deploy the SSL Certificate Tracking App to Azure App Service (Basic B1 SKU).

## Azure Context
- **Subscription:** 3593bd93-63f8-4f13-8fec-55ac8abc5f54
- **Resource Group:** SSL Tracker - RG (new)
- **Region:** Central India (centralindia)
- **App Name:** ssltracker

## Architecture
- **Mode:** MODIFY (existing app, adding Azure hosting)
- **Compute:** Azure App Service — Linux, Node 20 LTS, Basic B1 SKU
- **Database:** Azure SQL Database — Basic tier (5 DTU, 2 GB)
  - Entra-only authentication (no SQL admin login/password)
  - Tables: Certificates, Users, AuditLogs
- **Components:**
  - Frontend: Vite + React + TypeScript → built to `dist/` static files
  - Backend: Node.js scanner server (`server/scanner.mjs`) on port 3456
  - Combined into single App Service using a unified `server.mjs` entry point that serves both the static frontend and the scanner API

## Infrastructure (Bicep)
- `infra/main.bicep` — Subscription-scoped deployment creating the resource group
  - App Service Plan (Linux, B1)
  - Web App (Node 20 LTS)
  - SQL Server (Entra-only auth) + SQL Database (Basic tier)

## Configuration
- `azure.yaml` — AZD project config
- `server/server.mjs` — Production server combining static files + scanner API
- Startup command: `node server/server.mjs`

## Steps
- [x] Phase 1: Analyze workspace
- [x] Phase 1: Gather requirements
- [x] Phase 1: Confirm Azure context
- [x] Phase 2: Generate Bicep infrastructure
- [x] Phase 2: Create production server entry point
- [x] Phase 2: Create azure.yaml
- [ ] Phase 2: Validate
- [ ] Phase 2: Deploy
