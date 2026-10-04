# Ouvar Scraper — Frontend Implementation Guide

> Written for: an AI coding agent (or any engineer) building a fresh frontend against the v3 backend. Everything you need to call the API, interpret its data, and reproduce the operator UI is here. If the backend disagrees with this doc, trust the backend and update the doc.

---

## 1. What this service does

**Ouvar** is the warehouse / order-management platform that several freight-shipping tenants of ours use. This service is a **scraper + report generator** that sits on top of Ouvar's web APIs. It exists because:

1. **Nobody wants to click through Ouvar page by page.** The scraper pulls orders, their line items, and the referenced product details into our own Postgres DB.
2. **Freight invoicing is where mistakes get expensive.** With product dimensions and weights in our DB, we can calculate chargeable weight, flag oversized items, and audit carrier invoices against reality.

### The three jobs the backend does

| Job | Who triggers it | Where the work happens |
|---|---|---|
| **Scrape** orders / items / products from Ouvar for one tenant | Operator (via POST), or a schedule (via Temporal cron) | A Temporal `ScrapeTenantWorkflow` runs on a worker fleet |
| **Serve the freight report** (joined orders + items + products + stock lines, with derived flags) | FE | Django view → raw Postgres SQL |
| **Audit a carrier invoice** (upload a CSV of connotes, get back an .xlsx with a verdict column) | FE (file upload) | Django view, synchronous |

### Multi-tenant model

The scraper serves these tenants (hard-coded, same code everywhere):

```
MARS, ROYAL, KINRISE, ITW, PETBARN, KELLANOVA
```

Each tenant has:
- Its **own Ouvar origin** (the hostname differs per tenant).
- Its **own paste-your-browser-cURL authorization**. There is no OAuth; the operator opens the Ouvar web UI in their browser, right-clicks a request in devtools, "Copy as cURL", and pastes it into this backend. That cURL carries the JWT + the exact headers Ouvar expects. Tokens expire; when they do, the operator re-pastes.
- Its own slice of every table (`tenant` column everywhere; `(tenant, order_id)` is the uniqueness contract — order id `1234` for MARS is a different order from `1234` for ITW).

### Why the FE needs to understand this

- **Token lifecycle is operator-visible UX.** The dashboard must say which tenants have a usable token, which have expired, and which Ouvar has rejected (401/403). An expired token means scrapes for that tenant silently become no-ops until someone re-pastes.
- **Scrapes are long.** A page is 10–100 orders, each order needs an items call, each product needs its own call. A 10-page scrape is minutes. The FE must not block the user on it — it should **submit the scrape, show the run id, and poll run state**.
- **Freight report is the main daily surface.** It's a big filterable table of stock lines with derived flags (length/width/height/weight/diagonal/cubic/chargeable). Operators use it to find bad data to fix, and to generate the "which products trip which thresholds" list.

---

## 2. Backend architecture at a glance

```
┌──────────────┐           POST /api/tenants/<T>/scrape
│   Frontend   │ ───────────────────────────────────────┐
│   (new)      │           GET  /api/report/*           │
│              │           POST /api/report/tnt-analysis│
└──────────────┘ ◀──────────────────────────────────────┤
                                                        ▼
                                        ┌──────────────────────────┐
                                        │  Django (config/urls.py) │
                                        │  - scraper/api.py        │
                                        │  - scraper/report.py     │
                                        │  - scraper/tnt.py        │
                                        │  - scraper/search.py     │
                                        │  - tenants/views.py      │ ← paste-cURL HTML page
                                        └──────────┬───────────────┘
                                                   │
                                 submits workflow  │  reads/writes
                                                   ▼
                   ┌────────────────┐      ┌────────────────┐
                   │ Temporal       │      │   Postgres     │
                   │  worker fleet  │─────▶│   (shared)     │
                   │ (temporal_app) │      └────────────────┘
                   └────────────────┘
                            │
                            │ HTTP (with pasted auth)
                            ▼
                   ┌────────────────┐
                   │  Ouvar.com     │
                   └────────────────┘
```

- The **Django process** serves the HTTP API and the one HTML page (`/tokens/`).
- The **Temporal workers** run the actual scraping. They are a separate process (`python -m temporal_app.worker`) and you scale them horizontally.
- The FE only talks to Django. Temporal is an implementation detail the FE never calls directly.

---

## 3. Base URL, auth, CORS

- **Base URL**: whatever host the Django process runs on, e.g. `http://localhost:8000`. Make this a `VITE_API_BASE` / `NEXT_PUBLIC_API_BASE` env var in the FE.
- **CORS**: already permissive on the backend. `CORS_ALLOWED_ORIGINS=*` in `.env` opens it to any origin; otherwise set it to your FE's origin (comma-separated).
- **Auth**: optional `X-API-Key` header. The backend reads `OUVAR_API_KEY` from env; if it is set, every `/api/*` request must send `X-API-Key: <that value>`, else 401. If the env var is empty, auth is disabled. The FE should:
  - Read the key from `VITE_API_KEY` / equivalent env var.
  - Attach `X-API-Key: <key>` to every request only when the var is defined. Never log it.
- **Credentials**: no cookies, no login flow. The service assumes an authenticated reverse proxy or a trusted network.

---

## 4. The API

All endpoints are under `/api/`. All responses are JSON unless noted (CSV / XLSX endpoints send binary). Error responses: `{"error": "message"}`, status 4xx/5xx.

### 4.1 `GET /api/tenants` — dashboard overview

List every tenant with its token state, how much we have stored, and the last scrape.

**Response**
```json
{
  "tenants": [
    {
      "tenant": "MARS",
      "label": "Mars",
      "token": {
        "stored": true,
        "expired": false,
        "expires_at": "2026-10-15T04:12:00+00:00",
        "updated_at": "2026-09-30T12:04:11+00:00"
      },
      "orders_stored": 12483,
      "products_stored": 921,
      "last_run": {
        "run_id": 42,
        "tenant": "MARS",
        "status": "success",
        "stop_reason": "known_order",
        "stop_reason_label": "Reached an order already stored",
        "pages_fetched": 1,
        "orders_seen": 100,
        "orders_created": 4,
        "orders_updated": 96,
        "items_saved": 410,
        "products_saved": 2,
        "started_at": "2026-10-01T06:00:03+00:00",
        "finished_at": "2026-10-01T06:00:38+00:00",
        "duration_seconds": 35.1,
        "warnings": [],
        "error": "",
        "...": "see §4.3 for the full ScrapeRun shape"
      }
    }
    // one entry per tenant, in the fixed TENANT_CODES order
  ]
}
```

`token.stored=false` means no cURL has ever been pasted. `token.expired=true` means we either know the JWT exp has passed or Ouvar has rejected it — in both cases the UI should prompt the operator to go to `/tokens/` and re-paste.

### 4.2 `GET /api/tenants/<TENANT>/scrape` — one tenant detail

Same tenant card as above, plus the 10 most recent runs for that tenant.

**Path**: `TENANT` is case-insensitive, e.g. `MARS` or `mars`. Unknown → 404.

**Response**
```json
{
  "tenant": "MARS",
  "label": "Mars",
  "token": { /* same shape as §4.1 */ },
  "orders_stored": 12483,
  "products_stored": 921,
  "latest_order_id": 998877,
  "runs": [ /* up to 10 ScrapeRun objects, newest first */ ]
}
```

### 4.3 `POST /api/tenants/<TENANT>/scrape` — start a scrape

Submits a Temporal workflow. Returns **immediately** (202) unless you pass `wait=1`.

**Body** (JSON or form, all optional)
```json
{
  "max_pages": 10,          // 1..50, default 10
  "page_size": 10,          // 1..100, default 10
  "start_page": 1,          // alias accepted: "from_page"
  "ignore_known": false,    // true = backfill; keep walking past orders we already have
  "refresh_products": false,// true = re-fetch product detail even if we have it
  "wait": false             // true = block until the workflow completes
}
```

**Response (202, async)**
```json
{
  "tenant": "MARS",
  "workflow_id": "scrape-tenant-MARS-ab12cd34",
  "temporal_task_queue": "ouvar-task-queue",
  "message": "scraping MARS via Temporal from page 1",
  "poll_runs": "/api/tenants/MARS/scrape"
}
```
There is no `run.id` in this response — the run row is created inside the workflow. **To find it**, poll `GET /api/tenants/<T>/scrape` and look for the newest run with `status=running` (or match on `started_at` close to now). This is a mild wart of the async handoff; if you want a stricter contract later, we can have the API hold the request until the run row exists.

**Response (200/502, wait=1)**
```json
{
  "tenant": "MARS",
  "workflow_id": "...",
  "run": { /* a ScrapeRun dict with status/stop_reason/counters */ }
}
```
HTTP 200 when `status == "success"`, 502 otherwise.

**Error cases**
- `409` + `{"error": "No token stored for MARS. ..."}` — tenant has no usable credential. UI: send the operator to `/tokens/`.
- `400` — bad parameter (non-integer, negative, etc.).
- `502` — Temporal unreachable or workflow submission failed.

### 4.4 `GET /api/runs/<id>` — poll one run

```json
{
  "run": {
    "run_id": 42,
    "tenant": "MARS",
    "status": "running",              // "running" | "success" | "failed"
    "stop_reason": "",                // empty while running; see enum below
    "stop_reason_label": "",
    "max_pages": 10,
    "page_size": 100,
    "start_page": 1,
    "last_page": 7,                   // start_page + pages_fetched - 1; null if 0 pages
    "ignore_known": false,
    "pages_fetched": 7,
    "orders_seen": 684,
    "orders_created": 12,
    "orders_updated": 672,
    "items_saved": 2103,
    "products_saved": 4,
    "warnings": ["order 998123: items unavailable (HTTP 500 ...)"],
    "error": "",
    "started_at": "2026-10-01T06:00:03+00:00",
    "finished_at": null,              // set when status != running
    "duration_seconds": null
  }
}
```

**`status` enum**: `running | success | failed`
**`stop_reason` enum**: `known_order | max_pages | empty_page | unauthorized | error` (empty while running).

**Polling cadence suggestion**: 2s while `status=running`. Give up after no-change for ~30 min; the workflow would have been retried or failed by then.

### 4.5 `POST /api/orders/find` — find orders by connote across tenants

Synchronous. For when a connote shows "not found" in a report and the operator wants to pull just that one order in without re-scraping the tenant's history.

**Body**
```json
{
  "references": ["RKV100021801", "RKU100045832"],  // or a comma-separated string
  "tenants": ["MARS", "ROYAL"],                     // optional, default: all
  "all_tenants": false,                             // true = don't stop at first hit
  "refresh_products": false,
  "limit": 10                                       // Ouvar search page size, 1..50
}
```

**Response**
```json
{
  "searched": 2,
  "found": 1,
  "not_found": ["RKU100045832"],
  "orders_stored": 1,
  "results": [
    {
      "reference": "RKV100021801",
      "found": true,
      "tenant": "MARS",
      "tenants_searched": ["MARS"],
      "orders": [
        {
          "tenant": "MARS",
          "order_id": 998877,
          "order_number": "PO-884",
          "tracking_number": "RKV100021801",
          "already_stored": false,
          "items_saved": 3,
          "products_saved": 1
        }
      ],
      "ignored_non_matches": 0,
      "warnings": []
    },
    { "reference": "RKU100045832", "found": false, "orders": [], "warnings": [...] }
  ],
  "skipped_tenants": {}  // tenant -> reason, for tenants without a usable token
}
```

**Limits**: 200 references per request. **Timing**: ~1s per reference per tenant tried. Budget accordingly or split into batches.

### 4.6 `GET /api/report/filters` — dropdown values for the report

```json
{
  "tenants": ["ITW", "KELLANOVA", "KINRISE", "MARS", "PETBARN", "ROYAL"],
  "stores": ["Store Alpha", "Store Beta", ...],
  "segments": ["Retail", "Wholesale", ...],
  "date_range": {
    "min_date": "2024-01-01T00:00:00Z",
    "max_date": "2026-10-01T12:00:00Z"
  }
}
```
Use to populate dropdowns and the date-picker min/max.

### 4.7 `GET /api/report/stock-lines` — the main report

Paged, filterable, sortable. One row per **stock line** (an order's item's product's stock entry — the thing freight is charged on).

**Query params** (all optional unless noted)

| Param | Type | Default | Notes |
|---|---|---|---|
| `search` | string | — | Case-insensitive, matches order_number / tracking_number / store_name / product code / product name / marks |
| `tenant` | csv | — | `MARS,ROYAL` |
| `store_name` | csv | — | |
| `segment` | csv | — | |
| `date_from` | `YYYY-MM-DD` | — | Inclusive, on `created_date` |
| `date_to` | `YYYY-MM-DD` | — | Inclusive of the whole end day |
| `missing_dimensions` | bool | false | Rows with null/zero height/width/length/weight |
| `has_stock_line` | bool | false | Exclude orders whose items have no stock line |
| `size_issue` | bool | false | Only rows where `flag_any_dimension_issue=true` |
| `weight_issue` | bool | false | Only rows where `flag_weight_out_of_range=true` |
| `sort` | enum | `created_date` | See sortable keys below |
| `direction` | `asc\|desc` | `desc` | |
| `limit` | int | 100 | 1..1000 |
| `offset` | int | 0 | |

**Sortable `sort` values**: `tenant`, `order_id`, `order_number`, `store_name`, `segment`, `tracking_number`, `created_date`, `product_code`, `product_name`, `quantity`, `uom_name`, `is_double_pallet`, `product_per_pallet`, `height`, `width`, `length`, `weight`, plus every derived key: `flag_length_out_of_range`, `flag_width_out_of_range`, `flag_height_out_of_range`, `diagonal_length_mm`, `flag_diagonal_over_1200mm`, `flag_any_dimension_issue`, `flag_weight_out_of_range`, `mhp_diameter_cm`, `cubic_volume_m3`, `cubic_kg`, `chargeable_kg`. Unknown values silently fall back to `created_date`.

**Flag/bool truth table**: every `flag_*` column is **`true | false | null`**. **`null` means "could not be checked"** (the input dimension was never scraped). This is the "blank rule" — the FE must render `null` as empty, not as a passing green tick. A `false` is a positive statement: "we checked it, it's within range".

**Response**
```json
{
  "rows": [
    {
      "order_row_id": 123,
      "tenant": "MARS",
      "order_id": 998877,
      "order_number": "PO-884",
      "store_name": "Store Alpha",
      "segment": "Retail",
      "tracking_number": "RKV100021801",
      "created_date": "2026-09-28T04:12:00Z",
      "item_row_id": 456,
      "item_id": 7788,
      "ouvar_product_id": 9911,
      "product_row_id": 321,
      "product_code": "SKU-123",
      "product_name": "Example product",
      "stock_line_id": 876,
      "container": "product_items",
      "source": "inventory",
      "marks": "...",
      "marks_type": "...",
      "quantity": 4,
      "uom_name": "Each",
      "is_double_pallet": false,
      "product_per_pallet": 48,
      "height": 180,
      "width": 220,
      "length": 310,
      "weight": 2.4,
      "flag_length_out_of_range": false,
      "flag_width_out_of_range": false,
      "flag_height_out_of_range": false,
      "diagonal_length_mm": 379.21,
      "flag_diagonal_over_1200mm": false,
      "flag_any_dimension_issue": false,
      "flag_weight_out_of_range": false,
      "mhp_diameter_cm": 37.92,
      "cubic_volume_m3": 0.012276,
      "cubic_kg": 3.069,
      "chargeable_kg": 3.069
    }
  ],
  "total": 2683,
  "limit": 100,
  "offset": 0,
  "summary": {
    "rows_total": 2683,
    "orders": 1041,
    "products": 148,
    "stock_lines": 2500,
    "size_issues": 32,
    "weight_issues": 7,
    "incomplete_rows": 183
  }
}
```

- `total` is for pagination.
- `summary` is for the tiles at the top of the page. These are computed over the **filtered** set, so clicking a filter updates the tiles too.

### 4.8 `GET /api/report/stock-lines.csv` — CSV export

Same query params as above. Streams a CSV. Response headers to watch:
- `Content-Disposition: attachment; filename="ouvar-stock-lines.csv"`
- `X-Total-Rows`: how many rows match the filter.
- `X-Row-Cap`: hard cap (50 000).
- `X-Row-Cap-Hit: 1` present when the file was truncated.

Trigger from the FE by setting `window.location.href = ".../report/stock-lines.csv?..."` (with the API key in the URL isn't ideal — if the key is set, prefer a `fetch` → `Blob` → `URL.createObjectURL` download so the key goes in a header).

### 4.9 `POST /api/report/tnt-analysis` — audit a carrier invoice

Upload a carrier CSV (TNT, StarTrack, whoever), get back an **.xlsx** with the original columns plus:
- `Require Attention` (TRUE/FALSE/blank — blank means we had no data to judge)
- `Attention Reason`
- `Length`, `Width`, `Height`, `Weight`, `Diagonal Length (mm)`, `MHP Diameter (cm)`, `Cubic Volume (m3)`, `Cubic Weight (kg)`, `Chargeable Weight (kg)`

**Request** (`multipart/form-data`)
- Field name: `file` (required).
- Optional query param `?connote_column=<name>` if the CSV calls the connote column something other than `Connote`.
- Max 32 MB, max 20 000 rows per upload.

**Response**
- `200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Body: the .xlsx bytes.
- Headers: `Content-Disposition`, `X-Csv-Rows`, `X-Connotes`, `X-Connotes-Matched`, `X-Rows-Needing-Attention`.

**FE pattern**: `fetch` with a FormData body, `response.blob()`, create object URL, click a hidden anchor to download. Show a progress spinner and the counts from the response headers after it lands.

### 4.10 `GET /tokens/` and `POST /tokens/` — paste a cURL (HTML page)

Not a JSON API — it's a Django-rendered HTML page. One form per tenant; each form takes a textarea where the operator pastes a `curl ...` command captured from the browser's devtools. On submit, the backend parses the Authorization header + the rest of the headers and stores them against that tenant.

**Options for the FE**:
1. **Easiest**: deep-link out to `/tokens/`. The HTML page already works. A row on the tenant dashboard that says "Token expired" can just link there.
2. **Nicer**: build a FE version. The POST body is `curl_<TENANT>=<raw cURL text>` (one field per tenant you want to update), form-encoded. The response is a 302 redirect on success, or a 400 HTML page re-render on parse error. If you want this as a FE flow, we should add a JSON variant `POST /tokens/<TENANT>` → `{status, masked_authorization, expires_at}`. Ask and we'll add it.

The existing HTML template is at [tenants/templates/tenants/credentials.html](tenants/templates/tenants/credentials.html) if you want to see the field layout.

---

## 5. Operator UI the FE should ship

Three surfaces cover 99% of the real usage. Build these first.

### Surface A — **Tenants dashboard** (home)

Grid of cards, one per tenant. Each card shows:
- Tenant label (`Mars`, `Royal`, …).
- Token state badge: `Live` (green), `Expired` (red + link to `/tokens/`), `Not set` (grey + link to `/tokens/`). Compute from `token.stored`, `token.expired`.
- Counts: `orders_stored`, `products_stored`.
- Last run summary (if any): status, stop reason label, counts (orders_created / orders_updated / products_saved), relative time (`3h ago`), duration.
- **Primary button**: `Scrape now`. Opens a small dialog with the knobs from §4.3 (max_pages, page_size, ignore_known, refresh_products). Submits POST, then switches the card to a "Scraping…" state and starts polling (see §6 below).

Data source: `GET /api/tenants`. Poll every 30s or on tab focus.

### Surface B — **Freight report** (biggest surface)

Three parts stacked:

1. **Filter bar** (left-aligned, sticky). Populated from `GET /api/report/filters`. Includes:
   - Free-text search box
   - Tenant multi-select, Store multi-select, Segment multi-select
   - Date range picker (bounded by `date_range.min_date` / `max_date`)
   - Toggle chips: `Missing dimensions`, `Has stock line`, `Size issue`, `Weight issue`
   - "Export CSV" button on the right (hits §4.8 with the same filters)

2. **Summary tiles** (horizontal strip). From `summary` in §4.7. Clicking a tile should toggle the matching filter chip (`size_issues` ↔ `size_issue=1`, etc.).

3. **Data table**. Columns in order:
   - Tenant, Order #, Store, Segment, Tracking #, Created date
   - Product code, Product name, Qty, UoM
   - Length, Width, Height, Weight, Diagonal
   - Chargeable (kg) with the Cubic volume as a tooltip
   - A compact "flags" column showing one icon per `flag_*` where `true`; empty when all `false`; a dash when all `null`.
   - Sortable headers (map to the sort keys in §4.7).
   - Server-side pagination (`limit` + `offset`), default page size 100, user-selectable up to 1000.

**Rendering the flag triad (true/false/null)**:
- `true` → red icon + tooltip with the rule
- `false` → nothing (or a very muted check — do not use green by default; most rows are false and the table would be a wall of green)
- `null` → `—` or empty cell. Hover tooltip: "Not enough data to check"

**Date/number formatting**:
- All dates are ISO 8601 with `Z` suffix. Use the browser's locale for display, but keep ISO as the data-attr for sort stability.
- Numbers come back as JSON numbers (DECIMAL → float). Format mm with no decimals, kg with 2 decimals, m3 with 4–6 decimals.

### Surface C — **Carrier invoice audit** (TNT upload)

One page:
- File-drop zone (accepts `.csv`).
- Optional "Connote column name" text input (defaults to `Connote`).
- Submit → `POST /api/report/tnt-analysis` with multipart body.
- While waiting: a spinner.
- On success: trigger the browser download of the returned .xlsx and show a result banner using the response headers:
  - "Analysed 384 rows / 220 unique connotes — 198 matched, **17 need attention**." Link to re-upload.

**Secondary surfaces** (lower priority):

- **Run detail / live tail** — a tenant card's "Scraping…" state can drill into a run page that shows the full ScrapeRun dict with its warnings list.
- **Order lookup** — a page for `POST /api/orders/find`. One textarea where operators paste a column of connotes, optional tenant filter, button → shows the per-reference results.

---

## 6. Patterns the FE must get right

### 6.1 The scrape poll loop

```
POST /api/tenants/MARS/scrape  → 202, workflow_id
loop every 2s for up to 30 min:
  GET /api/tenants/MARS/scrape → runs[0]
  find the run that started after our POST (compare started_at, or just take runs[0] if status=running)
  if status=running: show counters, keep polling
  if status in (success, failed): stop, show final counters
```

**Edge case**: between the 202 and the first poll, the run row might not yet exist (the activity that creates it hasn't run). If `runs[0].started_at` is before our POST, show "Starting…" and keep polling for ~10s before complaining.

### 6.2 Token-expired → re-paste flow

When any API call returns `409` with a message starting `No token stored for X` or `The stored token for X expired`, surface a banner: "`X`'s token has expired. [Re-paste cURL]". The link goes to `/tokens/`.

The `GET /api/tenants` dashboard will already show the expired state, so a 409 mid-action is a "something changed since last refresh" case — refresh the dashboard too.

### 6.3 CSV / XLSX downloads with the API key

If `VITE_API_KEY` is set, you cannot just do `<a href="/api/report/stock-lines.csv">` because the browser won't send the header. Pattern:

```ts
const res = await fetch(url, { headers: { 'X-API-Key': KEY } });
const blob = await res.blob();
const href = URL.createObjectURL(blob);
const a = Object.assign(document.createElement('a'), {
  href,
  download: suggestedName(res.headers.get('content-disposition')),
});
a.click();
URL.revokeObjectURL(href);
```

Also read `X-Total-Rows` / `X-Row-Cap-Hit` from `res.headers` to warn when the export was capped.

### 6.4 Timestamps

All ISO 8601, UTC rendered as `Z`. Do not re-parse and re-serialize unless you have to; the backend's contract is "what you got". For "3h ago" formatting, use a library (`date-fns`'s `formatDistanceToNow`, Luxon's `toRelative`).

### 6.5 Error handling

Every endpoint returns `{"error": "..."}` on 4xx. Render it verbatim — the backend writes human-readable messages ("The stored token for MARS expired on 2026-10-01 06:00 UTC. Re-paste a fresh cURL on /tokens/.") that are already fit for a toast.

### 6.6 Don't over-poll

- Tenants dashboard: 30s refresh, or on tab focus.
- Run detail while running: 2s.
- Report: no polling, refetch on filter change (debounced ~250ms).
- Filters endpoint: once per session is fine; its data changes slowly.

---

## 7. Minimal data types for the FE

Copy-paste starters. Adjust for your framework.

```ts
export type TenantCode = 'MARS' | 'ROYAL' | 'KINRISE' | 'ITW' | 'PETBARN' | 'KELLANOVA';

export interface TokenState {
  stored: boolean;
  expired?: boolean;
  expires_at?: string | null;  // ISO 8601
  updated_at?: string;
}

export type ScrapeRunStatus = 'running' | 'success' | 'failed';
export type ScrapeStopReason =
  | '' | 'known_order' | 'max_pages' | 'empty_page' | 'unauthorized' | 'error';

export interface ScrapeRun {
  run_id: number;
  tenant: TenantCode;
  status: ScrapeRunStatus;
  stop_reason: ScrapeStopReason;
  stop_reason_label: string;
  max_pages: number;
  page_size: number;
  start_page: number;
  last_page: number | null;
  ignore_known: boolean;
  pages_fetched: number;
  orders_seen: number;
  orders_created: number;
  orders_updated: number;
  items_saved: number;
  products_saved: number;
  warnings: string[];
  error: string;
  started_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
}

export interface TenantSummary {
  tenant: TenantCode;
  label: string;
  token: TokenState;
  orders_stored: number;
  products_stored: number;
  last_run: ScrapeRun | null;
}

export interface TenantDetail extends TenantSummary {
  latest_order_id: number | null;
  runs: ScrapeRun[];
}

export interface StockLineRow {
  order_row_id: number;
  tenant: TenantCode;
  order_id: number;
  order_number: string;
  store_name: string;
  segment: string;
  tracking_number: string;
  created_date: string | null;
  item_row_id: number | null;
  item_id: number | null;
  ouvar_product_id: number | null;
  product_row_id: number | null;
  product_code: string;
  product_name: string;
  stock_line_id: number | null;
  container: string;
  source: string;
  marks: string;
  marks_type: string;
  quantity: number | null;
  uom_name: string;
  is_double_pallet: boolean | null;
  product_per_pallet: number | null;
  height: number | null;
  width: number | null;
  length: number | null;
  weight: number | null;
  flag_length_out_of_range: boolean | null;
  flag_width_out_of_range: boolean | null;
  flag_height_out_of_range: boolean | null;
  diagonal_length_mm: number | null;
  flag_diagonal_over_1200mm: boolean | null;
  flag_any_dimension_issue: boolean | null;
  flag_weight_out_of_range: boolean | null;
  mhp_diameter_cm: number | null;
  cubic_volume_m3: number | null;
  cubic_kg: number | null;
  chargeable_kg: number | null;
}

export interface ReportResponse {
  rows: StockLineRow[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    rows_total: number;
    orders: number;
    products: number;
    stock_lines: number;
    size_issues: number;
    weight_issues: number;
    incomplete_rows: number;
  };
}
```

---

## 8. Tech stack suggestions (not prescriptive)

- **Framework**: React + Vite, or Next.js (App Router) if SSR / routing complexity grows.
- **Data layer**: TanStack Query (`useQuery` for GETs, `useMutation` for POSTs, built-in polling with `refetchInterval`).
- **UI kit**: pick one — shadcn/ui, Mantine, or Chakra. The table and filter bar are the busy pieces; a kit saves time.
- **Table**: TanStack Table for sorting/pagination with server-side mode.
- **File download**: no library needed; the `Blob` + `URL.createObjectURL` pattern in §6.3 is enough.
- **Date formatting**: `date-fns` (small) or Day.js.
- **Env vars**: `VITE_API_BASE`, `VITE_API_KEY` (both optional in dev).

---

## 9. Running the backend locally (so the FE agent can test)

From the `ouvar_scraper_v3/` directory:

```bash
# 1. Install deps (one time)
pip install -r requirements.txt

# 2. Set env
cp .env.example .env   # or create .env with:
#   DJANGO_SECRET_KEY=insecure-dev
#   DJANGO_DEBUG=True
#   DJANGO_ALLOWED_HOSTS=*
#   DB_* (point at your Postgres)
#   TEMPORAL_HOST=localhost:7233
#   CORS_ALLOWED_ORIGINS=http://localhost:5173
#   OUVAR_API_KEY=    (empty disables auth; nice for local)

# 3. Set up the schema
python manage.py migrate

# 4. Start the API
python manage.py runserver 0.0.0.0:8000

# 5. (Separately, in another terminal) Start Temporal + a worker
#    so POST /api/.../scrape actually does work.
temporal server start-dev
python -m temporal_app.worker

# 6. (Optional) Paste a token so a scrape has credentials
open http://localhost:8000/tokens/
```

The FE should assume `http://localhost:8000` as the dev API base.

---

## 10. Open questions to raise with the backend team

Only raise if the FE pushes against them:

1. **No run id in the 202 POST response.** If the FE polling pattern in §6.1 feels fragile, ask for the API to create the run row before returning (we can do this; it'd be a small change).
2. **No JSON token endpoint.** The paste-cURL page is HTML-only. If you want a FE-native flow, say so.
3. **Search endpoint is sync.** Fine today; if someone pastes 200 connotes and we're uncomfortable blocking the request thread for ~minutes, we can wrap it in a workflow too.
4. **No auth per user.** `X-API-Key` is a shared secret, not per-user. If multi-user becomes a requirement, this spec changes.

Nothing in this document is load-bearing on those — the FE can ship around them.

---

## 11. Build order (the first PR)

1. Scaffold the app, add `VITE_API_BASE` + `VITE_API_KEY`, a small `fetchJson` wrapper that attaches `X-API-Key` and parses `error` from 4xx.
2. **Surface A — Tenants dashboard**. The scrape dialog + poll loop. Covers §4.1–4.4 and §6.1–6.2.
3. **Surface B — Freight report**. §4.6–4.8. The filter bar + table + CSV export.
4. **Surface C — Carrier invoice audit**. §4.9.
5. Secondary: order lookup page (§4.5), run detail drill-in.

Ship 1–4 first. Everything else is nice-to-have.
