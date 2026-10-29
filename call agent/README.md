# Toyota Digital Retail · Call Agent CRM

Browser prototype for assigning guest leads from call agents to showroom sales advisors. Built for Abdul Latif Jameel Motors · Toyota Digital Retail.

> **Prototype only.** Data lives in `localStorage`. Passwords are salted and hashed in the browser. There is no server session and this is **not** production security.

---

## Quick start

1. Serve the folder over HTTP (required for `crypto.subtle` password hashing):

   ```bash
   # from the repo root (demo-main/)
   npx --yes serve "call agent" -p 5173
   ```

   Or open via any local static server. Opening `login.html` as a `file://` URL may fail password hashing.

2. Open: [http://localhost:5173/login.html](http://localhost:5173/login.html)

3. Sign in (demo seed):

   | Role | How to sign in |
   |------|----------------|
   | **Admin** | Name: Layla Alharbi · Username / password: `admin` / `admin123` |
   | **Call agent / Sales advisor** | Choose your name · Username and password = **employee number** (e.g. `48448`) |

After login you are routed by role:

| Role | Home page |
|------|-----------|
| Admin | `admin.html` |
| Call agent | `call-agent.html` |
| Sales advisor | `sales-advisor.html` |

---

## What it does

```
Guest enquiry  →  Call agent creates/assigns lead  →  Connected sales advisor works the lead
                      ↑                                      ↑
                 Team Connections (admin)              Confirm product / status / note
```

- Admins configure users, car models, statuses, and which advisors each agent may assign to.
- Call agents enter a **lead number**, product, status, and a **connected** sales advisor, then assign.
- Sales advisors see only leads assigned to them, confirm the product, update status, and send a note.
- Activity is logged for assignments, status changes, and admin actions. Times display in **Asia/Riyadh**.

---

## Folder structure

```
call agent/
├── login.html              Sign-in
├── admin.html              Admin workspace (Chart.js)
├── call-agent.html         Call agent desk (SheetJS / Excel export)
├── sales-advisor.html      Sales advisor desk
├── assets/
│   └── mark.svg            Brand mark
├── css/
│   └── style.css           Shared UI
├── js/
│   ├── data.js             Store, seed, CRM API (`window.TDR`)
│   ├── auth.js             Session + role gate (`window.Auth`)
│   ├── admin.js            Admin views
│   ├── call-agent.js       Agent desk
│   └── sales-advisor.js    Advisor desk
└── README.md               This file
```

---

## Roles and screens

### Admin (`admin.html`)

Sidebar views:

| View | Purpose |
|------|---------|
| **Dashboard** | KPIs + Chart.js charts (status mix, daily assignments, agents, advisors, vehicles) + recent activity |
| **CRM Leads** | Full lead register: search, filters, create / edit / reassign / delete |
| **User Accounts** | All roles: create, edit, reset password, enable / disable, delete |
| **Call Agents** | Agent roster, lead counts, manage connections |
| **Sales Advisors** | Advisor roster, confirmed counts, manage connections |
| **Team Connections** | Link agents ↔ advisors; disconnect keeps existing leads |
| **Car Models** | Active catalog used on assign forms |
| **Status Management** | Status list, order, colors, activate / deactivate |
| **Assignment Monitor** | Live feed of recent assignments |
| **Activity Log** | Filterable audit trail (capped ~400 events) |
| **Settings** | Company / system name, defaults, session length, notifications, **Restore demo data** |

### Call agent (`call-agent.html`)

- KPIs for **their** leads only.
- **New lead**: lead number + product + status + connected advisor → **Assign**.
- Lead numbers must be unique (e.g. `CRM-2026-000123`).
- Can only assign to advisors linked via **Team Connections**.
- Lead sheet with search, sort, pagination, and **Export Excel**.

### Sales advisor (`sales-advisor.html`)

- Sees only leads where `salesAdvisorId` is theirs.
- **Open** a lead → confirm product, set status, add note → **Send**.
- Toast when a new lead is assigned (if notifications are on in Settings).
- Read-only list of connected call agents.

---

## Lead lifecycle

1. **Create / assign (call agent)**  
   `assignNewLead` creates a lead with lead number, requested car, status, agent, and advisor. History entry: *Lead Assignment*.

2. **Advisor response**  
   Advisor confirms product + status + optional note. Sets `advisorConfirmed`, `vehicleDecision = "Confirmed Requested Car"`. Activity: *Advisor Sent*.

3. **Admin maintenance**  
   Create/edit/reassign/delete from CRM Leads; connections and catalogs from admin nav.

### Important lead fields

| Field | Meaning |
|-------|---------|
| `leadNumber` | External CRM id (unique) |
| `customerName` / `phone` | Used more on admin-created leads |
| `requestedCar` / `selectedCar` | Product on assign; advisor may confirm |
| `callAgentId` / `salesAdvisorId` | Ownership |
| `statusId` / `statusName` | Pipeline status |
| `vehicleDecision` | e.g. Confirmed Requested Car / Choose Other Car |
| `financeType` | Cash / Lease (advisor path) |
| `note` / `advisorConfirmed` | Advisor send |
| `history[]` | Per-lead timeline |
| `createdAt` / `assignedAt` / `updatedAt` | ISO timestamps |

Default seed statuses: New, Contacted, Interested, No Answer, Follow Up, Confirmed, Other Car, Not Interested, Completed, Cancelled.

---

## Data & storage

| Key | Where | Purpose |
|-----|--------|---------|
| `tdr_crm_store_v2` | `localStorage` | Full CRM state (users, leads, cars, statuses, connections, activity, settings) |
| `tdr_crm_session` | `sessionStorage` | Current login |
| `tdr_crm_remember` | `localStorage` | Optional “Remember me” |
| `tdr_seen_<userId>` | `localStorage` | Advisor “already toasted” lead ids |

- First visit (empty store) runs `seed()` in `data.js` (demo admin, roster, cars, statuses, sample leads, connections).
- Multi-tab: `storage` events reload memory and notify subscribers.
- **Restore demo data** (Admin → Settings) reseeds the workspace.

### Central API (`window.TDR`)

UI pages should call these instead of touching `localStorage` directly. Later, replace `load` / `save` with a backend and keep the same function names.

Examples: `users`, `leads`, `cars`, `statuses`, `connections`, `advisorsForAgent`, `assignNewLead`, `assignLead`, `advisorUpdate`, `createUser`, `setConnections`, `saveSettings`, `activity`, `subscribe`, `showToast`, `openModal`.

### Auth (`window.Auth`)

- `login(username, password, remember)`
- `requireRole(role)` — redirect if wrong / missing session
- `logout()`, `current()`, `homeFor(user)`

Session expires after `settings.sessionMinutes` (default **480**).

---

## Dependencies (CDN)

| Library | Used on | Why |
|---------|---------|-----|
| [Chart.js 4.4.1](https://www.chartjs.org/) | `admin.html` | Dashboard charts |
| [SheetJS / xlsx 0.18.5](https://sheetjs.com/) | `call-agent.html` | Excel export |
| [Manrope](https://fonts.google.com/specimen/Manrope) | All pages | Typography |

No build step. Plain HTML + CSS + JS.

---

## Typical workflows

### Connect a team (admin)

1. Sign in as admin → **Team Connections**.
2. Select a call agent → check sales advisors → **Save connections**.
3. Agents can only assign to those linked advisors.

### Assign a lead (call agent)

1. Sign in as a call agent.
2. Enter lead number, product, status, advisor.
3. **Assign to sales advisor**.
4. Row appears on the agent desk and on the advisor’s **My leads**.

### Work a lead (sales advisor)

1. Sign in as the assigned advisor.
2. **Open** the lead → check **Confirm this product** → set status / note → **Send**.

### Reset passwords (admin)

**User Accounts** → **Reset password**. Passwords are never shown in tables.

---

## Security notes (prototype)

- Demo credentials are intentional and shown on the login screen.
- Hashing uses `SHA-256(salt:password)` in the browser — fine for a demo, not for production.
- No server auth, CSRF protection, or httpOnly cookies.
- For production: move login to `POST /api/auth/login`, store hashes only on the server, and replace `load`/`save` with authenticated APIs.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| “This browser cannot hash passwords” | Serve over `http://localhost` (or HTTPS), not `file://` |
| Wrong home page after login | Role on the user account must match (`admin` / `call-agent` / `sales-advisor`) |
| “Advisor is not connected to you” | Admin must link them under **Team Connections** |
| Stale / broken demo data | Admin → Settings → **Restore demo data** (wipes the local store) |
| Charts missing | Check Chart.js CDN on `admin.html` |
| Excel export fails | Check SheetJS CDN on `call-agent.html` |

---

## Roadmap (suggested)

1. Replace `localStorage` with a real API; keep `TDR.*` method names.
2. Server-side auth and password hashing.
3. Real CRM lead sync (import lead numbers instead of free typing).
4. Notifications via push / email instead of in-browser toasts.
5. Role-based API permissions and audit export.
