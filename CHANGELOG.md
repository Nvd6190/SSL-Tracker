# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-05-20

### Changed

- Renamed app title from "SSL Certificate Tracking App" to "SSL Certificate Manager".
- Updated sidebar brand to "SSL Tracker" with footer "SSL Tracker v1.0".
- Renamed navigation items: "Dashboard" → "Overview", "Subdomain Discovery" → "Subdomain Scanner".
- Updated page header: "Operations cockpit" → "Certificate Operations", "SSL Certificate Tracking" → "Certificate Overview".
- Revised page subtitle to "Track certificate health, manage renewal timelines, and maintain clear ownership to prevent service disruptions."
- Changed priority banner label from "Highest Priority" to "Needs Attention".
- Updated metric tab labels: "All Certificates" → "Total Certificates", "Expiring ≤ X days" → "Due in X Days", "Not Fetched" → "Pending Scan".
- Renamed toolbar buttons: "+ Add Domain" → "+ Add Certificate", "Re-scan All" → "Refresh All".
- Updated table section: "Inventory" → "Certificate Inventory", "Certificate List" → "Managed Certificates".
- Refreshed placeholder text: "Enter customer / org" → "Add customer or organisation", etc.
- Improved empty-state message: "No certificates match the current filters" → "No matching certificates found."
- Updated Subdomain Discovery page: "DNS Intelligence" → "Network Intelligence", "Total Subdomains" → "Subdomains Found", "Domains Scanned" → "Domains Analysed".
- Updated Add Domain modal: renamed to "Add Certificate", field labels refined ("Customer Name" → "Contact Name", "Notes" → "Remarks").
- Updated Import modal: "Bulk entry" → "Bulk import", "Import certificates" → "Import Certificates".
- Rewrote README.md with updated feature list, tech stack, project structure, and available scripts.

## [0.1.0] - 2025-01-01

### Added

- Initial MVP: React + TypeScript + Vite single-page application.
- Seeded certificate inventory with sample NovaBank domains.
- Dashboard with summary metrics, search, and filter controls.
- Renewal pipeline with urgency-based sorting.
- Add Domain modal with auto SSL scanning.
- CSV import with bulk SSL scanning.
- Subdomain discovery with background scanning.
- Inline editing for customer details and remarks.
- Express backend with SQL Server persistence (optional).
- Azure Bicep infrastructure templates for deployment.
