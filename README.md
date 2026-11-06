# Inventory Manager

Вебзастосунок складського обліку для малого бізнесу (MVP): акаунти з ізольованим складом, демо без
реєстрації (24 години), товари й категорії з архівом, надходження та списання з чернетками, проведенням і
сторнуванням, інвентаризація, історія рухів, 5 звітів із CSV та дашборд. Оцінка — за середньозваженою
собівартістю. UI англійською, адаптивний (desktop / tablet / mobile) за погодженими макетами.

## Стек

| Шар | Технологія |
| --- | --- |
| Frontend | SolidJS 1.9 + TypeScript 7, Vite 8, Vitest 5 |
| Backend | Python 3.14, FastAPI, Pydantic 2, SQLAlchemy 2.1 (psycopg 3), Alembic, pytest, ruff, uv |
| БД | PostgreSQL 18 |
| Вебсервер | Caddy 2.11 (статичний фронтенд + проксі `/api`, автоматичний HTTPS) |
| Запуск | Docker Compose |

## Структура

```
backend/            FastAPI-застосунок
  app/              main.py (фабрика), config.py (env), db.py, models.py, schemas.py,
                    errors.py (єдиний формат помилок), api/ (health, demo)
  migrations/       Alembic (0001_demo_items — технічна демо-таблиця з одним рядком)
  tests/            pytest: unit + інтеграційні з реальним PostgreSQL
  Dockerfile        target runtime (непривілейований користувач) і test
frontend/           SolidJS + Vite
  src/api/client.ts спільний HTTP-клієнт (ApiError, розбір формату помилок, мережеві збої)
  src/pages/        екрани (auth, dashboard, products, categories, documents, stock-counts, history, reports)
  src/components/   оболонка й спільні компоненти (за app.js макета); FRONTEND.md — правила
caddy/              Caddyfile і Dockerfile (збирає фронтенд, віддає його Caddy)
e2e/                e2e-сценарії та скриншоти app vs макет через Caddy (playwright-core + локальний Chrome)
docker-compose.yml  postgres, migrate, backend, caddy (+ профіль test)
docker-compose.dev.yml  override для розробки: порти бекенду й БД на 127.0.0.1, /api/docs
```

## Швидкий старт (Docker)

```bash
cp .env.example .env
# обов'язково змініть POSTGRES_PASSWORD, наприклад: openssl rand -hex 24
docker compose up -d --build
docker compose ps        # postgres, backend, caddy — healthy; migrate — Exited (0)
open http://127.0.0.1:8094
```

Порядок старту: `postgres` (healthy) → `migrate` (`alembic upgrade head`, одноразовий,
має завершитися з кодом 0) → `backend` (healthy) → `caddy` (healthy).
Міграції виконуються окремим сервісом, тож при масштабуванні бекенду вони не запускаються
паралельно. Повторно застосувати вручну: `docker compose run --rm migrate`.

Зупинка: `docker compose down` (дані зберігаються в томі `postgres-data`);
повне очищення: `docker compose down -v`.

## Порти й URL (за замовчуванням)

| Що | Адреса | Примітка |
| --- | --- | --- |
| Застосунок через Caddy | http://127.0.0.1:8094 | `HTTP_PORT`, `PUBLIC_BIND_ADDRESS` |
| HTTPS Caddy | 127.0.0.1:8454 | `HTTPS_PORT`; локально не використовується |
| Тестова БД (профіль test) | 127.0.0.1:5445 | `TEST_POSTGRES_PORT` |
| Backend (лише dev override) | http://127.0.0.1:8010 | `BACKEND_HOST_PORT`; `/api/docs` |
| PostgreSQL (лише dev override) | 127.0.0.1:5444 | `POSTGRES_HOST_PORT` |
| Vite dev server | http://127.0.0.1:5174 | `VITE_DEV_PORT` |

У базовому `docker-compose.yml` назовні публікується лише Caddy. PostgreSQL і бекенд
доступні тільки всередині мережі compose.

## Змінні оточення

| Змінна | За замовч. | Призначення |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `inventory-manager` | префікс контейнерів/томів/мереж |
| `POSTGRES_USER` / `POSTGRES_DB` | `inventory` | облікові дані БД |
| `POSTGRES_PASSWORD` | — (обов'язкова) | пароль БД; без неї compose не стартує |
| `APP_ENV` | `production` | `development` вмикає `/api/docs` та `/api/openapi.json` |
| `LOG_LEVEL` | `INFO` | рівень логування бекенду |
| `SITE_ADDRESS` | `:80` | адреса сайту в Caddy: `:80` — HTTP; домен — автоматичний HTTPS |
| `PUBLIC_BIND_ADDRESS` | `127.0.0.1` | інтерфейс хоста для портів Caddy (`0.0.0.0` на VPS) |
| `HTTP_PORT` / `HTTPS_PORT` | `8094` / `8454` | порти хоста для Caddy 80/443 |
| `TEST_POSTGRES_PORT` | `5445` | порт тестової БД |
| `BACKEND_HOST_PORT` / `POSTGRES_HOST_PORT` | `8010` / `5444` | порти dev override |
| `COOKIE_SECURE` | `false` | `true` на VPS з HTTPS — cookie сесії лише через HTTPS |
| `DEMO_LIFETIME_HOURS` | `24` | строк життя демо |
| `DEMO_RATE_LIMIT_PER_HOUR` / `DEMO_GLOBAL_LIMIT_PER_HOUR` | `10` / `500` | ліміти створення демо (на IP / загалом) |

Бекенд сам читає `DATABASE_URL` (`postgresql+psycopg://user:pass@host:5432/db`), `APP_ENV`,
`LOG_LEVEL`; у compose `DATABASE_URL` складається з `POSTGRES_*`.
Фронтенд у dev-режимі: `VITE_API_PROXY_TARGET` (за замовч. `http://127.0.0.1:8010`), `VITE_DEV_PORT`.

## Розробка

Фронтенд (Node 24+, npm). Якщо в оточенні `NODE_ENV=production`, додавайте `--include=dev`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build   # БД + бекенд
cd frontend
npm ci --include=dev
npm run dev            # http://127.0.0.1:5174, /api проксується на бекенд
```

Бекенд локально (потрібні Python 3.14 і [uv](https://docs.astral.sh/uv/)):

```bash
cd backend
uv sync
DATABASE_URL=postgresql+psycopg://inventory:<пароль>@127.0.0.1:5444/inventory \
  APP_ENV=development uv run uvicorn app.main:app --reload --port 8010
```

Нова міграція: `uv run alembic revision --autogenerate -m "..."` (з `DATABASE_URL` на dev-БД).

## Тести

```bash
# Backend: ruff + pytest (unit + інтеграційні) у контейнері з реальним PostgreSQL (tmpfs)
docker compose --profile test run --rm --build backend-tests
docker compose --profile test down       # прибрати тестову БД

# Frontend: перевірка типів, Vitest, production-збірка
cd frontend && npm ci --include=dev && npm run typecheck && npm test && npm run build

# Браузерні e2e-сценарії через Caddy (стек має бути запущений; потрібен Google Chrome і docker compose для psql)
cd e2e && npm ci --include=dev && BASE_URL=http://127.0.0.1:8094 npm run scenarios   # лог → docs/evidence/scenarios.log
# Скриншоти app vs макет (1440/834/390) → docs/screenshots/task-003/ (MOCKUP_DIR — шлях до дизайн-проєкту);
# генеруються локально, у репозиторій не входять (docs/screenshots/ у .gitignore)
cd e2e && npm run screenshots
```

Інтеграційні тести беруть БД з `TEST_DATABASE_URL`; без неї вони пропускаються (skip).
Тести **очищають схему `public`** цієї БД і застосовують міграції, тож не вказуйте робочу БД.
Локальний запуск pytest проти тестової БД з профілю test:

```bash
docker compose --profile test up -d postgres-test
cd backend && TEST_DATABASE_URL=postgresql+psycopg://test:test@127.0.0.1:5445/inventory_test uv run pytest
```

## API

Повний контракт — [`docs/api.md`](docs/api.md). Коротко: `/api/auth/*` (sign-up, sign-in, demo, sign-out, me),
`/api/categories`, `/api/products` (+ `export.csv`, archive/restore, movements), `/api/receipts`,
`/api/write-offs` (чернетка → `post` → `reverse`), `/api/reversals/{id}`, `/api/stock-counts`, `/api/movements`,
`/api/reports/{stock-on-date|movement|low-stock|write-offs-by-reason|stock-value}` (`format=csv`),
`/api/dashboard`. Технічний `/healthz` через Caddy недоступний.

Клієнт надсилає `X-Timezone` (IANA); дати в параметрах і групування за днями/тижнями — у цій зоні,
часові мітки у відповідях — UTC.

### Автентифікація й сесії

- Пароль ≥ 8 символів, хеш Argon2id. Сесія — випадковий токен у cookie `im_session` (HttpOnly,
  SameSite=Lax, `Secure` при `COOKIE_SECURE=true`); у БД зберігається лише SHA-256 токена. Строк — 30 днів.
- Захист від перебору: 10 невдалих входів на email або 30 на IP за 15 хв → `429 too_many_attempts`.
- Ізоляція: кожен запит фільтрується за акаунтом сесії; чужі id → 404.

### Демо

- `POST /api/auth/demo` створює окремий тимчасовий акаунт і наповнює його набором даних макетів
  (9 категорій, 29 товарів, ~2,5 місяця проведених документів, сторно, інвентаризації, чернетки, товари з
  низьким залишком). Дані проводяться через ті самі сервіси, що й дії користувача; дати зсуваються так, щоб
  «сьогодні» макета було днем створення демо (у часовому поясі відвідувача).
- Діє `DEMO_LIFETIME_HOURS` (24) години. Фонове завдання в бекенді (раз на `CLEANUP_INTERVAL_SECONDS`, 60 с,
  з advisory lock PostgreSQL) видаляє прострочені демо з усіма даними (каскад FK). Запит із простроченою
  сесією теж одразу видаляє демо й повертає `401 demo_expired` → екран demo-expired.
- Вихід із демо, вхід або реєстрація з демо-сесії видаляють демо; дані не переносяться.
- Захист від зловживань: `DEMO_RATE_LIMIT_PER_HOUR` нових демо на IP (10) і `DEMO_GLOBAL_LIMIT_PER_HOUR`
  загалом (500) → `429 rate_limited`.

### Облік і собівартість

- Залишок зберігається в товарі, кожна зміна — рядок `movements` (кількість, залишок після, собівартість
  після, зміна вартості). Від'ємний залишок заборонений (перевірка під блокуванням + CHECK у БД).
- Середньозважена собівартість: надходження `avg' = (S·avg + q·p)/(S+q)`; списання й інвентаризація
  оцінюються за `avg` на момент проведення і його не змінюють; сторно надходження знімає `q` за ціною рядка
  (`avg' = (S·avg − q·p)/(S−q)`, якщо залишок > 0), що відновлює попередню середню; сторно списання повертає
  товар за собівартістю списання. До першого надходження `avg` = закупівельна ціна.
- Конкурентність: проведення/сторно блокує документ (`SELECT … FOR UPDATE`), потім товари в порядку id;
  повторне проведення/сторно неможливе. Нумерація — лічильник на акаунт (`RC-`, `WO-`, `RV-`, `SC-`).
- Звіти на дату / за період беруть залишок і собівартість із рухів на той момент.
- Одиниці: `pcs`, `pack` — цілі; `kg`, `g`, `l`, `m`, `m²` — до 3 знаків. Одиницю не можна змінити після
  появи рухів товару.

### Єдиний формат помилок

Усі помилки API мають вигляд:

```json
{"error": {"code": "validation_error", "message": "Check the highlighted fields.",
           "details": [{"field": "lines.0.qty", "message": "Enter a quantity greater than 0.", "type": "invalid_qty"}]}}
```

| HTTP | `code` | Коли |
| --- | --- | --- |
| 400 | `invalid_json` | тіло запиту — некоректний JSON |
| 422 | `validation_error` | помилки Pydantic; `details[].field` — шлях до поля через крапку (`null`, якщо помилка не прив'язана до поля), `type` — машинний тип помилки Pydantic |
| 404 | `not_found` | немає маршруту або ресурсу |
| 405 | `method_not_allowed` | метод не підтримується (заголовок `Allow` зберігається) |
| 503 | `unavailable` | `/healthz`, БД недоступна |
| 500 | `internal_error` | непередбачена помилка; деталі лише в логах сервера |

Інші HTTP-статуси отримують `code` з таблиці в `backend/app/errors.py` або `http_error`.
Фронтенд-клієнт (`frontend/src/api/client.ts`) перетворює все на `ApiError`
(`status`, `code`, `message`, `details`, `fieldErrors()`); мережевий збій — `code: "network_error"`,
`status: 0`; не-JSON відповідь з помилкою (напр. 502 від проксі) — `code: "http_error"`.

## Розгортання на VPS

Потрібні Docker Engine з Compose v2, DNS-запис A/AAAA домену на IP VPS, відкриті порти 80 і 443.

### Варіант A — Caddy з цього compose є вхідною точкою (порти 80/443 вільні)

```bash
git clone <repo> inventory-manager && cd inventory-manager
cp .env.example .env
# у .env:
#   POSTGRES_PASSWORD=<openssl rand -hex 24>
#   APP_ENV=production
#   COOKIE_SECURE=true
#   SITE_ADDRESS=inventory.example.com
#   PUBLIC_BIND_ADDRESS=0.0.0.0
#   HTTP_PORT=80
#   HTTPS_PORT=443
docker compose up -d --build
docker compose ps
docker compose logs -f caddy     # отримання сертифіката Let's Encrypt
```

Caddy сам отримує й поновлює сертифікат, перенаправляє HTTP → HTTPS; сертифікати
зберігаються в томі `caddy-data` (не видаляйте його без потреби, щоб не впертися в ліміти ACME).

### Варіант B — на VPS уже працює інший Caddy на 80/443

Залиште `SITE_ADDRESS=:80`, `PUBLIC_BIND_ADDRESS=127.0.0.1`, оберіть вільний `HTTP_PORT`
(напр. `8094`), а в Caddyfile зовнішнього Caddy додайте:

```
inventory.example.com {
	reverse_proxy 127.0.0.1:8094
}
```

### Оновлення та резервні копії

```bash
git pull && docker compose up -d --build     # migrate застосує нові міграції перед стартом backend
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql
```

## Безпека контейнерів

- `backend`/`migrate` працюють від користувача `app` (uid 10001), `caddy` — від `caddy` (uid 10002;
  низькі порти доступні завдяки `cap_net_bind_service` у бінарнику Caddy), PostgreSQL — штатно
  від `postgres`.
- PostgreSQL не публікується (у dev override — лише на `127.0.0.1`).
- Через Caddy доступні тільки статичний фронтенд і `/api/*`; `/healthz`, admin API Caddy
  (`localhost:2019`) і внутрішній healthcheck Caddy (`127.0.0.1:8081`) ззовні недоступні;
  `/api/docs` вимкнено в `production`.

## License

Проєкт поширюється за ліцензією MIT — див. [LICENSE](LICENSE).
