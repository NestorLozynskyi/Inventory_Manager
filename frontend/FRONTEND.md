# Frontend conventions (for page authors)

SolidJS + TypeScript + Vite, `@solidjs/router`. No UI kits: the visual system is the design project's
`tokens.css` + `app.css` (copied verbatim to `src/styles/`, edits marked `/* impl: … */`). Components reproduce
the DOM / class names of the mockups' `app.js`, so **write the same markup as the mockup** and it will look right.

## Pages and routing

- Routes are in `src/App.tsx` (lazy, paths are final). Each page file `src/pages/**.tsx` has a **default export**;
  overwrite the placeholder. App routes are already behind `RequireAuth` (no session → `/sign-in`, expired demo →
  `/demo-expired`); auth pages are behind `GuestOnly` (`/sign-up` also admits demo users — the page ends the demo).
- App pages render the shell themselves:

  ```tsx
  export default function ProductList() {
    return (
      <AppShell active="products" title="Products">   {/* title → topbar + "Products · Inventory Manager" */}
        <div class="page-header">…<h1>Products</h1>…</div>
        …
      </AppShell>
    );
  }
  ```
  `active`: `dashboard | products | categories | receipts | write-offs | stock-counts | history | reports | null`.
  The shell adds sidebar / rail / mobile bars, account menu, sign-out dialogs and the demo banner.
- Auth pages (no shell): `<main class="auth-layout"><div class="auth-card">…</div></main>`; set `document.title`.
- Links: plain `<a href="/products/12">` — the router intercepts them (client-side navigation). Programmatic:
  `useNavigate()`, params: `useParams()`.
- Session: `me()` from `src/lib/auth.ts` (`email`, `is_demo`, `demo_expires_at`, `currency`); `signIn`, `signUp`,
  `startDemo`, `signOut`, `loadMe(force)`.

## Styles

Page-local styles from a mockup's `<style>` block go **into a CSS file next to the page**, imported by it, keeping
the selectors (e.g. `pages/NotFound.css` ← `screens/404.html`). Use tokens only; don't restyle shared classes.

## API client — `src/api/client.ts`

```ts
import { api, qs, ApiError } from "../../api/client";
const list = await api.get<ProductList>(`/api/products${qs(filters())}`, signal);
await api.post("/api/receipts", body); api.put(…); api.patch(…); api.delete(…);
await api.download(`/api/products/export.csv${qs(f)}`, "products.csv"); // file name from Content-Disposition
```
- Sends `X-Timezone` and the session cookie automatically. 401 `unauthenticated` / `demo_expired` on non-auth
  endpoints redirect centrally — don't handle them in pages.
- Errors are `ApiError`: `status`, `code`, `message` (user-facing English), `fieldErrors()` (`{"lines.2.qty": "…"}`),
  `generalErrors()`, `raw` (extra keys: `raw.shortages`, `raw.product_count`, `raw.retry_after`), `isNetworkError`.

## Formatting — `src/lib/format.ts`

`fmtNumber, fmtQty(v, unit), fmtSignedQty, fmtMoney, fmtSignedMoney, fmtMoneyCompact, fmtDate, fmtDateTime, fmtTime`
(identical to the mockups; true minus `−`; API UTC timestamps shown in local time; `"YYYY-MM-DD"` dates unshifted),
`toIsoDate()` for date params, `UNITS`, `isFractionalUnit`, `maxDecimals`, `fitsUnitPrecision`, `WRITE_OFF_REASONS`,
`parseDecimalInput` (`""` → null, invalid → NaN, accepts `12,5` / `1,234.5` / `−4`), `plural`, `countLabel`.

## Load states — `src/lib/resource.ts` + `components/LoadView.tsx`

```tsx
const products = createLoader((signal) => api.get<ProductList>(`/api/products${qs(filters())}`, signal));
// signals read inside the fetcher (filters()) trigger a reload; previous request is aborted.
<LoadView loader={products} skeleton={<SkeletonRows cols={6} />}
          isEmpty={(d) => d.items.length === 0} empty={<EmptyState icon="box" title="No products found" />}>
  {(d) => <ProductsTable items={d().items} />}
</LoadView>
```
`state()`: `loading` (skeleton) · `refreshing` (data kept; `skeletonOnRefresh` to show skeleton) · `ready` · `error`
(ErrorState with "Try again" → `reload()`). `mutate()` updates data locally after a mutation.

## List filters in the URL — `src/lib/url.ts`

```ts
const [filters, setFilters, reset] = useListFilters(
  { search: "", status: "active", category_id: "", low_stock: false, sort: "name", order: "asc" },
  { enums: { status: ["active", "archived", "all"], order: ["asc", "desc"] } });
setFilters({ status: "archived" });   // replaceState; defaults are removed from the URL
```
Types come from the defaults (string / number / boolean). Debounce search input yourself before `setFilters`.

## Components — `src/components/`

| | |
| --- | --- |
| `Icon` | `<Icon name="search" size={16} />` — all icons of the mockups (`ICON_NAMES`) |
| `Badge`, `StatusBadge` | `<Badge kind="low" />`, `<StatusBadge doc={doc} />` (reversal kinds → "Reversal") |
| `EmptyState`, `ErrorState`, `SkeletonRows` | same props as `IM.emptyState/errorState/skeletonRows`; `ErrorState onRetry` |
| `Modal` | `<Modal open onClose title size="sm" confirmLabel confirmVariant="danger" onConfirm confirmBusy>{body}</Modal>`; custom `footer` (mark buttons `data-im-confirm` / `data-im-cancel` for initial focus); bottom sheet on mobile via CSS |
| `confirm()` | `if (await confirm({ title, body, confirmLabel, confirmVariant, cancelLabel, action }))` — `action` (async) shows the loading button; if it throws, the dialog stays open and an error toast shows its message |
| `Sheet` | `<Sheet open onClose title>…</Sheet>` |
| `toast()` | `toast({ type: "success" \| "error" \| "info", title, text, duration })` → `{ dismiss }` (region is global) |
| `Menu` | `<Menu items={[…]} align="end">{(t) => <button … {...t}>…</button>}</Menu>`; items `{label, icon, href, onClick, danger, disabled}` \| `{divider: true}` \| `{header, sub}` |
| `BarChart`, `HBarChart` | same options as `IM.chart.bars/hbars` (`valueFormat: "money" \| "qty" \| "number" \| fn`) |

Overlays render through `Portal`, set `has-overlay` on `<html>` and `inert` on `#root`.

## Checks

`npm run typecheck`, `npm test`, `npm run build` (use `npm install --include=dev`; the shell has `NODE_ENV=production`).
Tests: Vitest + `@solidjs/testing-library`; for router-dependent components wrap in `MemoryRouter` (see
`components/AppShell.test.tsx`, `App.test.tsx`).
