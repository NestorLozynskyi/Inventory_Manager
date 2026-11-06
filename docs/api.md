# Inventory Manager — REST API contract (MVP)

All endpoints are under `/api`, JSON in/out (except CSV exports). Authentication is a session
cookie (`im_session`, HttpOnly, SameSite=Lax, Secure in production). Every resource is scoped to
the signed-in account; other accounts' ids answer **404**.

Client sends `X-Timezone: <IANA name>` (e.g. `Europe/Kyiv`) on every request. Date-only
parameters (`date`, `from`, `to`) and day/week bucketing are interpreted in that zone
(default `UTC`). Timestamps in responses are ISO-8601 UTC (`2026-11-05T08:47:00Z`).

Numbers: quantities are JSON numbers with ≤ 3 decimals; money is JSON numbers rounded to 2
decimals; `avg_cost`/`unit_cost` up to 4 decimals. Currency is `USD` (from `/api/auth/me`).

## Errors

Uniform shape (from TASK-001):

```json
{"error": {"code": "validation_error", "message": "…", "details": [{"field": "lines.0.qty", "message": "Enter a quantity greater than 0.", "type": "…"}]}}
```

Messages are **English, user-facing** (never raw Pydantic texts). `field` paths use the request
field names, list indexes are numeric (`lines.2.product_id`). Extra keys may appear inside
`error` for specific codes (see `shortages`).

| HTTP | code | when |
| --- | --- | --- |
| 400 | `invalid_json` | malformed JSON |
| 401 | `unauthenticated` | no/invalid session |
| 401 | `demo_expired` | session belongs to a demo that has expired (account already deleted) |
| 401 | `invalid_credentials` | sign-in failed |
| 404 | `not_found` | unknown route or resource not in this account |
| 409 | `email_taken` | sign-up (details field `email`) |
| 409 | `duplicate_sku` | product create/update (field `sku`) |
| 409 | `duplicate_name` | category create/rename (field `name`) |
| 409 | `category_in_use` | delete category with products; `product_count` key in error |
| 409 | `document_not_draft` | edit/delete/post a non-draft document |
| 409 | `already_reversed` | reverse twice / reverse a reversal |
| 409 | `insufficient_stock` | posting or reversing would make stock negative; `shortages` key |
| 409 | `product_archived` | posting a document that references an archived product (field `lines.N.product_id`) |
| 422 | `validation_error` | field validation |
| 429 | `too_many_attempts` | sign-in brute-force lock (`retry_after` seconds key) |
| 429 | `rate_limited` | too many demo workspaces from this client (`retry_after`) |

`shortages`: `[{"product_id", "sku", "name", "unit", "required", "available", "line_index"}]`
(`required` = quantity the operation removes, `available` = current stock).

## Units

`pcs`, `pack` — **whole** quantities only. `kg`, `g`, `l`, `m`, `m²` — fractional, up to 3 decimals.
Applies to document quantities, stock count actual quantities and minimum stock.
A product's unit can be changed only while the product has no stock movements
(error `422 validation_error`, field `unit`, "The unit can't be changed after stock movements are recorded.").

## Auth — `/api/auth`

| | |
| --- | --- |
| `POST /sign-up` `{email, password}` | 201 `Me`, sets cookie. Password 8–128 chars. Email normalised to lower case. |
| `POST /sign-in` `{email, password}` | 200 `Me`, sets cookie. 10 failures / 15 min per email or per IP → 429. |
| `POST /demo` | 201 `Me` — new demo account with seeded data, sets cookie. 5 demos / hour / IP → 429. |
| `POST /sign-out` | 200 `{was_demo: bool}`; clears cookie. Demo: account and all data deleted. |
| `GET /me` | 200 `Me` |

`Me`: `{id, email, is_demo, demo_expires_at|null, currency: "USD", created_at}`.
Demo email looks like `demo-7f3a9c@demo.inventory.app`.

## Categories — `/api/categories`

- `GET /` → `[{id, name, product_count, active_product_count}]` sorted by name.
- `POST /` `{name}` → 201 Category. Name 1–60 chars, trimmed, unique case-insensitively.
- `PATCH /{id}` `{name}` → Category.
- `DELETE /{id}` → 204; `409 category_in_use` if any product (active or archived) uses it.

## Products — `/api/products`

`Product`: `{id, sku, name, category_id|null, category_name|null, unit, description, purchase_price,
sale_price, min_stock|null, stock, avg_cost, stock_value, is_low_stock, archived, archived_at|null,
created_at, updated_at, has_movements, last_receipt_at|null}`

- `is_low_stock` = `min_stock != null && stock <= min_stock` (regardless of archive flag; UI shows archived first).
- `avg_cost` = weighted average unit cost; before the first receipt it equals `purchase_price`.
- `stock_value` = `round(stock × avg_cost, 2)`.

Endpoints:
- `GET /?search=&category_id=<id|none>&status=active|archived|all&low_stock=true&sort=name|sku|category|stock|value|updated&order=asc|desc`
  → `{items: Product[], counts: {active, archived, all, low_stock}}` (counts ignore search/filters except none).
  Defaults: `status=active`, `sort=name`, `order=asc`. Search matches name or SKU (case-insensitive substring).
- `GET /export.csv?<same params>` → `text/csv` (`products-YYYY-MM-DD.csv`): SKU, Name, Category, Unit, Stock,
  Min stock, Avg cost, Stock value, Purchase price, Sale price, Status.
- `POST /` `ProductIn` → 201 Product. `ProductIn`: `{sku (1–40, trimmed, unique case-insensitive), name (1–120),
  category_id|null, unit, purchase_price ≥ 0 (≤ 2 dp), sale_price ≥ 0 (≤ 2 dp), min_stock|null ≥ 0, description ≤ 1000}`.
- `GET /{id}` → Product.
- `PUT /{id}` `ProductIn` → Product.
- `POST /{id}/archive` → Product (idempotent). `POST /{id}/restore` → Product.
- `GET /{id}/movements?limit=&offset=` → `{items: Movement[], total}` newest first.

## Documents

Common document fields: `{id, kind, number, status, created_at, posted_at|null, note, line_count, total}`

- `kind`: `receipt` | `write_off` | `receipt_reversal` | `write_off_reversal` | `stock_count`.
- `status`: `draft` | `posted` | `reversed` (originals that have been reversed). Reversal documents are `posted`.
- Numbers: `RC-000001` receipts, `WO-000001` write-offs, `RV-000001` reversals (shared sequence), `SC-000001` counts; per account.
- Dates are never editable. Drafts: `created_at`; posting sets `posted_at` = now.
- `reversal`: `{id, number, posted_at}` on reversed originals; `reverses`: `{id, number, kind}` on reversal documents.

Line (receipt): `{id, product: ProductRef|null, qty|null, price|null, total}`;
Line (write-off): `{id, product: ProductRef|null, qty|null, unit_cost, total}` — `unit_cost` = cost at posting
(drafts: current `avg_cost`, live).
`ProductRef`: `{id, sku, name, unit, archived, stock, avg_cost, purchase_price}`.

### Receipts — `/api/receipts`
- `GET /?search=&status=draft|posted|reversed|reversal&from=&to=` → `{items}` — receipts **and** receipt reversals,
  newest first (by `posted_at` or `created_at`). Item: common fields + `supplier`, `reversal`, `reverses`.
  Search matches number, supplier, note. Period filter uses the document date (posted_at or created_at).
- `POST /` `{supplier?, note?, lines: [{product_id|null, qty|null, price|null}]}` → 201 draft. Drafts accept incomplete lines.
- `GET /{id}`, `PUT /{id}` (draft only), `DELETE /{id}` (draft only, 204).
- `POST /{id}/post` → posted document. Validation (422): at least one line; every line needs a product
  (`lines.N.product_id` "Choose a product."), qty > 0 respecting unit (`lines.N.qty`), price ≥ 0 (`lines.N.price`).
  Archived product → 409 `product_archived`.
- `POST /{id}/reverse` `{note?}` → 201 reversal document (`receipt_reversal`); original becomes `reversed`.
  `409 insufficient_stock` if current stock is lower than the received quantity of any line.

### Write-offs — `/api/write-offs`
Same as receipts but `reason` (`Sale`, `Damaged`, `Expired`, `Lost / Theft`, `Internal use`, `Other`; required to
post, default `Sale`) instead of supplier; lines `{product_id|null, qty|null}`; list filter `reason=`.
Posting checks stock: `409 insufficient_stock` with all short lines (quantities of the same product are summed).
Reversal returns stock at the write-off's unit cost.

### Reversals — `/api/reversals/{id}` → reversal document (kind `receipt_reversal|write_off_reversal`) with lines
(copied from the original, `price`/`unit_cost` as in the original), `reverses`, `supplier` or `reason`.

### Stock counts — `/api/stock-counts`
- `GET /` → `{items: [{…common, scope: "all"|"category", category: {id,name}|null, line_count, counted,
  surplus_count, shortage_count, surplus_value, shortage_value, net_value}]}` newest first.
- `POST /` `{category_id|null, note?}` → 201 draft with one line per active product in scope (actual_qty null).
  422 if the scope has no active products.
- `GET /{id}` → document + `lines: [{id, product: ProductRef, book_qty, actual_qty|null, difference|null,
  unit_cost, value|null}]`. Draft: `book_qty` = current stock (live), `unit_cost` = current avg_cost.
  Posted: values at posting.
- `PATCH /{id}` `{note?, lines?: [{id, actual_qty|null}]}` (draft only) → document. Actual qty ≥ 0, unit rules.
- `DELETE /{id}` (draft only).
- `POST /{id}/post` → posted. Each counted line sets stock to actual qty; difference relative to stock at posting;
  zero differences produce no movement; not counted lines unchanged. 422 if no line is counted.

## Movements (history) — `/api/movements`
`GET /?search=&type=receipt|write_off|stock_count|reversal&product_id=&category_id=&from=&to=&limit=50&offset=0`
→ `{items: Movement[], total}` newest first.
`Movement`: `{id, at, type, document: {id, kind, number}, product: ProductRef(+category_name), qty_change,
balance_after, unit_cost, value_change}`.

## Reports — `/api/reports/<id>` (add `format=csv` for a CSV download)
- `stock-on-date?date=&category_id=` → `{rows: [{product, category_name, qty, avg_cost, value}], total_value,
  product_count, in_stock_count}` — quantity at end of `date`, valued at the average cost in effect then.
  Products created after `date` excluded; archived products included only when qty ≠ 0.
- `movement?from=&to=&category_id=` → `{rows: [{product, opening, received, written_off, adjustments, closing,
  opening_value, received_value, written_off_value, adjustments_value, closing_value}], totals: {…values}}`;
  reversals netted into received / written_off; values = actual movement values (cost at the time).
- `low-stock?category_id=` → `{rows: [{product, category_name, stock, min_stock, shortfall, last_receipt_at}],
  out_of_stock_count, restock_cost}` (active products only; restock at purchase price).
- `write-offs-by-reason?from=&to=&category_id=` → `{rows: [{reason, documents, lines, value, share}], total_value,
  document_count, line_count, reversed_numbers: [..]}` — posted (not reversed) write-offs only.
- `stock-value?category_id=` → without category: `{by: "category", rows: [{category: {id,name}|null, product_count,
  in_stock_count, value, share}], total_value, active_count, in_stock_count, archived_value}`; with category:
  `{by: "product", rows: [{product, stock, avg_cost, value, share}], category_value, total_value, …}`.

## Dashboard — `GET /api/dashboard?weeks=8`
`{today, kpis: {stock_value, active_products, archived_products, low_stock_count, received_30d, receipts_30d,
written_off_30d, write_offs_30d}, weeks: [{start, label, receipts, write_offs}], by_reason: [{reason, value}],
period: {from, to}, low_stock: {items: Product[≤5], total}, recent: Movement[≤8]}`
Weeks are Monday-based; receipts at receipt prices (net of reversals), write-offs at cost (net of reversals).
