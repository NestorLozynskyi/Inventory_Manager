/**
 * Shared HTTP client for the REST API (contract: docs/api.md).
 *
 * Every request sends `X-Timezone` (browser IANA zone) and the session cookie
 * (`credentials: 'same-origin'`).
 *
 * Every failure is normalised to ApiError:
 *  - server errors in the uniform format {"error": {code, message, details[], ...extra}};
 *    the whole `error` object is kept in `raw` (e.g. `shortages`, `product_count`, `retry_after`);
 *  - non-JSON / unexpected error bodies (e.g. proxy 502) -> code "http_error";
 *  - network failures (fetch rejected)                   -> code "network_error", status 0;
 *  - successful response with an unparseable body         -> code "invalid_response".
 *
 * 401 `unauthenticated` / `demo_expired` from any non-auth endpoint is reported to the
 * central auth-error handler (see setAuthErrorHandler) which redirects to /sign-in or
 * /demo-expired. Requests to /api/auth/* never trigger it.
 */

export interface ApiErrorDetail {
  field: string | null;
  message: string;
  type: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];
  /** The raw `error` object from the response body (extra keys such as `shortages`). */
  readonly raw: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: ApiErrorDetail[] = [],
    raw: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.raw = raw;
  }

  get isNetworkError(): boolean {
    return this.code === "network_error";
  }

  /** Map of field path -> first message, for showing errors next to form fields. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details) {
      if (d.field && !(d.field in out)) out[d.field] = d.message;
    }
    return out;
  }

  /** Details not tied to a specific field. */
  generalErrors(): string[] {
    return this.details.filter((d) => !d.field).map((d) => d.message);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseErrorBody(status: number, body: unknown, fallback: string): ApiError {
  if (isRecord(body) && isRecord(body.error)) {
    const e = body.error;
    const details: ApiErrorDetail[] = Array.isArray(e.details)
      ? e.details.filter(isRecord).map((d) => ({
          field: typeof d.field === "string" ? d.field : null,
          message: typeof d.message === "string" ? d.message : "",
          type: typeof d.type === "string" ? d.type : "unknown",
        }))
      : [];
    return new ApiError(
      status,
      typeof e.code === "string" ? e.code : "http_error",
      typeof e.message === "string" && e.message ? e.message : fallback,
      details,
      e,
    );
  }
  return new ApiError(status, "http_error", fallback);
}

/** IANA time zone of the browser ("Europe/Kyiv"); "UTC" if unavailable. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Extract the file name from a Content-Disposition header (RFC 6266 / 5987). */
export function filenameFromContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted) return quoted[1].replace(/\\(.)/g, "$1");
  const plain = /filename\s*=\s*([^;]+)/i.exec(header);
  return plain ? plain[1].trim() : null;
}

export type AuthErrorCode = "unauthenticated" | "demo_expired";
export type AuthErrorHandler = (code: AuthErrorCode, path: string) => void;

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Don't report 401 to the auth-error handler (default: false; always skipped for /api/auth/*). */
  skipAuthRedirect?: boolean;
}

export type FetchLike = typeof fetch;

export interface ApiClientOptions {
  timeZone?: () => string;
  onAuthError?: AuthErrorHandler;
  /** Triggers the browser download of a blob; injectable for tests. */
  saveBlob?: (blob: Blob, filename: string) => void;
}

const NETWORK_MESSAGE = "Couldn’t connect to the server. Check your connection and try again.";

export function defaultSaveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isAuthPath(path: string): boolean {
  return /^\/api\/auth(\/|$|\?)/.test(path);
}

export function createApiClient(
  baseUrl = "",
  fetchImpl: FetchLike = (...a) => fetch(...a),
  options: ApiClientOptions = {},
) {
  let authErrorHandler: AuthErrorHandler | undefined = options.onAuthError;
  const timeZone = options.timeZone ?? browserTimeZone;
  const saveBlob = options.saveBlob ?? defaultSaveBlob;

  async function send(path: string, opts: RequestOptions, accept: string): Promise<Response> {
    const headers: Record<string, string> = { Accept: accept, "X-Timezone": timeZone() };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    try {
      return await fetchImpl(baseUrl + path, {
        method: opts.method ?? "GET",
        headers,
        body,
        signal: opts.signal,
        credentials: "same-origin",
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ApiError(0, "network_error", NETWORK_MESSAGE);
    }
  }

  function fail(path: string, opts: RequestOptions, err: ApiError): never {
    if (
      err.status === 401 &&
      (err.code === "unauthenticated" || err.code === "demo_expired") &&
      !opts.skipAuthRedirect &&
      !isAuthPath(path)
    ) {
      authErrorHandler?.(err.code, path);
    }
    throw err;
  }

  async function readError(res: Response): Promise<ApiError> {
    const text = await res.text().catch(() => "");
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    return parseErrorBody(res.status, parsed, `Server error (HTTP ${res.status}).`);
  }

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await send(path, opts, "application/json");
    if (!res.ok) fail(path, opts, await readError(res));

    const text = await res.text().catch(() => "");
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(res.status, "invalid_response", "The server returned an invalid response.");
    }
  }

  /**
   * GET a file (e.g. CSV export) and trigger a browser download.
   * The file name comes from Content-Disposition, else `fallbackName`. Resolves with the name used.
   */
  async function download(path: string, fallbackName = "export.csv", signal?: AbortSignal): Promise<string> {
    const opts: RequestOptions = { signal };
    const res = await send(path, opts, "text/csv, */*");
    if (!res.ok) fail(path, opts, await readError(res));
    const blob = await res.blob();
    const name = filenameFromContentDisposition(res.headers.get("Content-Disposition")) ?? fallbackName;
    saveBlob(blob, name);
    return name;
  }

  return {
    request,
    download,
    get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
    put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
    patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
    delete: <T = void>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body }),
    /** Register the central 401 handler (App wires it to the router). */
    setAuthErrorHandler(handler: AuthErrorHandler | undefined) {
      authErrorHandler = handler;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Default client. Its 401 handler falls back to a full-page redirect until App installs one. */
export const api = createApiClient("", undefined, {
  onAuthError: (code) => {
    window.location.assign(code === "demo_expired" ? "/demo-expired" : "/sign-in");
  },
});

/** Build a query string from a params object, skipping null/undefined/"" values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
