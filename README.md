# Reaal — Internal Real Estate Management System

One place for property owners, inventory, buyer requirements, matching and offers. Built from the product requirements document: *find anything quickly, update anything easily, create an offer in seconds.*

**Owner → Unit → Requirement → Match → Offer**

## Quick start

Requirements: **Node.js 22.13+**. There's no separate database server: the app uses Node's built-in SQLite.

```bash
npm install
cp .env.example .env         # optional: set ADMIN_EMAIL / ADMIN_PASSWORD
npm run seed                 # optional: load ~240 demo units, owners and requirements
npm run dev                  # API on :3000, web app on http://localhost:5173
```

The first start creates a **Super Admin**. If you don't set `ADMIN_PASSWORD`, the login is `admin@reaal.local` / `ChangeMe123` and you must pick a new password on first sign-in. The demo seed also adds team members (`ahmed@`, `youssef@`, `sarah@`, `mariam@reaal.local`), all with password `Password123`.

Production:

```bash
npm run build
npm start                    # serves the API and the built web app on $PORT (default 3000)
```

All data lives in `DATA_DIR` (default `./data`): `reaal.db` plus `uploads/`. Back up that folder. Run behind HTTPS; cookies are `Secure` in production unless `COOKIE_SECURE=false`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | API (tsx watch) + Vite dev server with proxy |
| `npm run build` / `npm start` | Production build / run |
| `npm test` | API integration and unit tests (Vitest + Supertest) |
| `npm run typecheck` | Type-check client and server |
| `npm run seed [count]` | Demo data, only when inventory is empty |

## What's included

**Dashboard**: clickable KPI cards (total / available / reserved / sold units, owners, active requirements, offers, units added this week), recent team activity, units needing verification, quick actions.

**Universal search** (`/` or `Ctrl+K`): searches owners, phone numbers (any format: `+20 101…`, `0020…`, `010 1234 5678`), email, project, developer, phase, unit number, unit ID (`U-00012`), property type and agent. It matches partial text and multi-word queries like `Mivida A12`.

**Inventory grid** (Excel-like):
- **Editing:** click a cell, type or press Enter to edit, and Enter/Tab to save and move. Arrow keys, Home/End and PgUp/PgDn navigate.
- **Selection and clipboard:** Shift+click or drag selects a range. `Ctrl+C` / `Ctrl+V` copy and paste as TSV, so you can paste straight from Excel. Pasting one value fills the whole selection, and Delete clears cells.
- **Autosave:** edits save automatically. A pending cell shows a yellow corner; a failed save shows red with the reason on hover, plus a Retry button.
- **Columns:** sort (Shift for multi-sort), resize, drag to reorder, hide and pin.
- **Rows:** row checkboxes (Shift for ranges), bulk update, mark as verified, create a multi-unit offer, export selected, archive.
- **Filters:** status, verification age, developer, project, type, finishing, price / BUA / land / bedroom ranges, phase, delivery, agent, tags, dates, media, "my listings" and archived. The filter state is kept in the URL.
- **Saved views:** personal or shared with the team. Each view stores filters, sorting and column layout.

**Owners**: separate from properties, with duplicate detection by any phone number, email or name. The profile has Call and WhatsApp buttons (these record "last contacted"), properties owned, notes, activity including their units' history, and files.

**Unit profile**: identification, property details, financials, ownership, media (photos, floor plans, master plans, documents), internal info, notes, offer history and the full change log. It also has **Mark as Verified Today**, a quick status change, archive and restore.

**Verification freshness**: *Current / Needs attention / Potentially outdated*. The thresholds are configurable (default 15 and 30 days). Assigned agents are notified once per level.

**Duplicate detection**: runs for units (same project and normalised unit number) and owners (phone, email, name). The dialog offers **View Existing / Cancel / Create Anyway**. Acknowledged duplicates are logged and admins are notified.

**Excel / CSV import** in 6 steps: upload → preview → map columns (auto-suggested, including Arabic headers) → validate → summary → confirm.
- **Validation** flags missing required data, invalid phones and numbers (it understands `42M`, `3.5m`, `42,000,000`), duplicate owners and properties (in the database and within the file), unknown values, new projects and developers, and ignored columns.
- **Duplicates** can be skipped, used to update existing records, or created anyway.

**Exports** of the entire inventory, filtered inventory, selected rows, owners or requirements, as Excel or CSV. Exports need a permission, are logged with row counts, and are protected against spreadsheet formula injection.

**Requirements & matching**: filters on project/developer, type, price, BUA, bedrooms and *Available* status, and ranks by preferred project, finishing, delivery, budget headroom and freshness. You can remove irrelevant results (and restore them), then select units → **Create Offer**. The requirement's agent is notified when a new matching unit appears.

**Offer creator**: opens from a unit, the inventory, a requirement or the Offers page.
- **Templates:** WhatsApp, Short, Detailed, PDF and Internal.
- **Output:** one editable message for any number of units. Editing never touches the database.
- **Actions:** Copy / Copy Without Price / Copy Without Owner Information (these work on edited text too), Save, Download PDF, Open in WhatsApp.
- **History:** copies and downloads are recorded automatically.

**Branded PDF**: company logo and colour, project, type, specs, price, photos, floor and master plans, and agent/company contact. Owner details are never included unless an admin allows it, and admins choose what appears.

**Notes** on owners, units and requirements, with `@mention` notifications. Notes are never included in offers.

**Tags**: managed by admins, and can be used as filters.

**Team**: users with role, status, last login, records added, offers and last activity. Actions: add (with temporary password), edit or change role, disable, reset password (one-time link or temporary password), and unlock.

**Permissions**: 25 granular permissions (`owners.view`, `owners.contact`, `inventory.export`, `records.purge`, …). You can edit the built-in Super Admin / Admin / Agent roles or create new ones. Owner phone numbers and emails are masked for roles without `owners.contact`. Managers can't modify Super Admins.

**Activity log**: covers every important action, with user, action, record, previous value, new value and timestamp. It is searchable and filterable. Users without `activity.view` see only their own actions.

**Archive instead of delete**: archiving keeps offers, ownership, activity and notes. Permanent deletion needs `records.purge`, the record must be archived first, and you confirm by typing its name or ID.

**Notifications**: unit needs verification, new requirement match, record assigned to you, import completed, duplicate created, @mention and password reset requests.

**Master data**: developers, projects (linked to developers), property types, finishing, sources, views. Values are matched case-insensitively, so "Mivida", "mivida" and "MIVIDA" are one project. Renaming a value updates existing records.

**Security**:
- **Passwords:** scrypt hashing, a password policy, temporary passwords that must be changed on first sign-in, and forgot-password requests that notify admins, who issue a one-time reset link.
- **Sessions:** httpOnly cookie sessions stored hashed in the database, with configurable inactivity logout enforced on both server and client.
- **Login protection:** per-account lockout and a per-IP throttle.
- **Requests and files:** CSRF header check, and uploads checked against a file-type allowlist and served only to users who can see the record.

**Responsive**: desktop-first. On mobile you can search, look up owners and properties, generate and copy offers, change status and add notes. Light and dark themes are included.

## Architecture

```
shared/     Types and logic used by both sides: permissions catalogue, phone normalisation,
            number/money parsing, filter spec, constants
server/     Express 5 API on node:sqlite
  db.ts           schema (created automatically) and query helpers
  auth.ts         password hashing, sessions, throttling, permission middleware
  routes/         one router per area (units, owners, requirements, offers, imports, …)
  services/       unit queries & filters, matching, offer template engine, PDF, import pipeline
  jobs.ts         hourly verification notifications and cleanup
  test/           API integration tests
client/     React 19 + Vite + React Router
  src/components/DataGrid.tsx   the virtualised spreadsheet grid
  src/pages/                    one file per screen
```

### Offer template syntax

Admins edit templates under **Settings → Offer templates**, with a live preview.

- `{{field}}`: inserts a value. The line is dropped if the value is empty.
- `{{?field}}`: an optional value. The line is kept even when the value is empty.
- `[[ | {{bedrooms}} BR]]`: an optional segment, dropped when any field inside it is empty.

Fields include `project`, `type`, `bua`, `land`, `bedrooms_label`, `finishing`, `delivery`, `asking_price`, `owner_name`, `agent_name`, `client_name`, `company_name` and more (the full list is on the settings page).
