import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, filenameFromContentDisposition, qs } from "./client";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const unauth = (code: string) => jsonResponse(401, { error: { code, message: "Sign in to continue.", details: [] } });

describe("api client", () => {
  it("returns parsed JSON on success and sends JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: 1 }));
    const client = createApiClient("", fetchMock);
    await expect(client.post("/api/x", { a: 1 })).resolves.toEqual({ id: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/x");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"a":1}');
  });

  it("sends X-Timezone and same-origin credentials on every request", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    const client = createApiClient("", fetchMock, { timeZone: () => "Europe/Kyiv" });
    await client.get("/api/a");
    await client.put("/api/b", { x: 1 });
    await client.patch("/api/c", { y: 2 });
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers["X-Timezone"]).toBe("Europe/Kyiv");
      expect(init.credentials).toBe("same-origin");
    }
    expect(fetchMock.mock.calls.map((c) => c[1].method)).toEqual(["GET", "PUT", "PATCH"]);
  });

  it("uses the browser's resolved time zone by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    await createApiClient("", fetchMock).get("/api/a");
    expect(fetchMock.mock.calls[0][1].headers["X-Timezone"]).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("delete resolves undefined on 204", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient("", fetchMock);
    await expect(client.delete("/api/receipts/1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("parses the uniform validation error with field details", async () => {
    const body = {
      error: {
        code: "validation_error",
        message: "Request validation failed.",
        details: [
          { field: "name", message: "too short", type: "string_too_short" },
          { field: "name", message: "second", type: "x" },
          { field: null, message: "general", type: "model_type" },
        ],
      },
    };
    const client = createApiClient("", vi.fn().mockResolvedValue(jsonResponse(422, body)));
    const err = await client.get("/api/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(422);
    expect(e.code).toBe("validation_error");
    expect(e.fieldErrors()).toEqual({ name: "too short" });
    expect(e.generalErrors()).toEqual(["general"]);
  });

  it("keeps extra error keys in `raw` (shortages, product_count, retry_after)", async () => {
    const shortages = [{ product_id: 7, sku: "A-1", name: "Tape", unit: "pcs", required: 5, available: 2, line_index: 0 }];
    const body = { error: { code: "insufficient_stock", message: "Not enough stock.", details: [], shortages } };
    const client = createApiClient("", vi.fn().mockResolvedValue(jsonResponse(409, body)));
    const e = (await client.post("/api/write-offs/1/post").catch((x: unknown) => x)) as ApiError;
    expect(e.code).toBe("insufficient_stock");
    expect(e.raw.shortages).toEqual(shortages);

    const c2 = createApiClient(
      "",
      vi.fn().mockResolvedValue(jsonResponse(429, { error: { code: "too_many_attempts", message: "Wait.", retry_after: 120 } })),
    );
    const e2 = (await c2.post("/api/auth/sign-in", {}).catch((x: unknown) => x)) as ApiError;
    expect(e2.raw.retry_after).toBe(120);
  });

  it("parses 404 in the uniform format", async () => {
    const body = { error: { code: "not_found", message: "Product not found.", details: [] } };
    const client = createApiClient("", vi.fn().mockResolvedValue(jsonResponse(404, body)));
    await expect(client.get("/api/x/9")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
      message: "Product not found.",
    });
  });

  it("handles non-JSON error bodies (e.g. proxy 502)", async () => {
    const res = new Response("<html>Bad gateway</html>", { status: 502 });
    const client = createApiClient("", vi.fn().mockResolvedValue(res));
    await expect(client.get("/api/x")).rejects.toMatchObject({
      status: 502,
      code: "http_error",
      message: "Server error (HTTP 502).",
    });
  });

  it("maps fetch rejection to network_error", async () => {
    const client = createApiClient("", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = (await client.get("/api/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.isNetworkError).toBe(true);
    expect(err.status).toBe(0);
  });

  it("rethrows aborts unchanged", async () => {
    const abort = new DOMException("aborted", "AbortError");
    const client = createApiClient("", vi.fn().mockRejectedValue(abort));
    await expect(client.get("/api/x")).rejects.toBe(abort);
  });

  it("reports invalid JSON in a successful response", async () => {
    const client = createApiClient("", vi.fn().mockResolvedValue(new Response("not json")));
    await expect(client.get("/api/x")).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("401 handling", () => {
  it("reports unauthenticated / demo_expired to the auth-error handler", async () => {
    const onAuthError = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce(unauth("unauthenticated")).mockResolvedValueOnce(unauth("demo_expired"));
    const client = createApiClient("", fetchMock, { onAuthError });
    await expect(client.get("/api/products")).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    await expect(client.get("/api/dashboard")).rejects.toMatchObject({ code: "demo_expired" });
    expect(onAuthError.mock.calls).toEqual([
      ["unauthenticated", "/api/products"],
      ["demo_expired", "/api/dashboard"],
    ]);
  });

  it("never redirects for the auth endpoints themselves", async () => {
    const onAuthError = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauth("unauthenticated"))
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "invalid_credentials", message: "x" } }))
      .mockResolvedValueOnce(unauth("demo_expired"));
    const client = createApiClient("", fetchMock, { onAuthError });
    await client.get("/api/auth/me").catch(() => undefined);
    await client.post("/api/auth/sign-in", {}).catch(() => undefined);
    await client.post("/api/auth/sign-out").catch(() => undefined);
    expect(onAuthError).not.toHaveBeenCalled();
  });

  it("ignores other 401 codes and other statuses", async () => {
    const onAuthError = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "something_else", message: "x" } }))
      .mockResolvedValueOnce(jsonResponse(403, { error: { code: "unauthenticated", message: "x" } }));
    const client = createApiClient("", fetchMock, { onAuthError });
    await client.get("/api/a").catch(() => undefined);
    await client.get("/api/b").catch(() => undefined);
    expect(onAuthError).not.toHaveBeenCalled();
  });

  it("uses the handler installed later with setAuthErrorHandler", async () => {
    const client = createApiClient("", vi.fn().mockResolvedValue(unauth("unauthenticated")));
    const handler = vi.fn();
    client.setAuthErrorHandler(handler);
    await client.get("/api/a").catch(() => undefined);
    expect(handler).toHaveBeenCalledWith("unauthenticated", "/api/a");
  });
});

describe("CSV download", () => {
  it("parses Content-Disposition file names", () => {
    expect(filenameFromContentDisposition('attachment; filename="products-2026-11-05.csv"')).toBe("products-2026-11-05.csv");
    expect(filenameFromContentDisposition("attachment; filename=report.csv")).toBe("report.csv");
    expect(
      filenameFromContentDisposition(`attachment; filename="fallback.csv"; filename*=UTF-8''stock%20on%20date.csv`),
    ).toBe("stock on date.csv");
    expect(filenameFromContentDisposition(null)).toBeNull();
    expect(filenameFromContentDisposition("inline")).toBeNull();
  });

  it("downloads the blob with the server file name", async () => {
    const saveBlob = vi.fn();
    const res = new Response("SKU,Name\nA-1,Tape\n", {
      status: 200,
      headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="products-2026-11-05.csv"' },
    });
    const fetchMock = vi.fn().mockResolvedValue(res);
    const client = createApiClient("", fetchMock, { saveBlob, timeZone: () => "UTC" });
    await expect(client.download("/api/products/export.csv?status=all")).resolves.toBe("products-2026-11-05.csv");
    const [blob, name] = saveBlob.mock.calls[0];
    expect(name).toBe("products-2026-11-05.csv");
    expect(await (blob as Blob).text()).toBe("SKU,Name\nA-1,Tape\n");
    expect(fetchMock.mock.calls[0][1].headers["X-Timezone"]).toBe("UTC");
  });

  it("falls back to the given name and throws ApiError on failure", async () => {
    const saveBlob = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("a,b", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(422, { error: { code: "validation_error", message: "Bad date.", details: [] } }));
    const client = createApiClient("", fetchMock, { saveBlob });
    await expect(client.download("/api/reports/low-stock?format=csv", "low-stock.csv")).resolves.toBe("low-stock.csv");
    await expect(client.download("/api/reports/movement?format=csv")).rejects.toMatchObject({ code: "validation_error" });
    expect(saveBlob).toHaveBeenCalledTimes(1);
  });
});

describe("qs", () => {
  it("skips empty values", () => {
    expect(qs({ search: "tape", category_id: "", low_stock: true, page: 2, x: null, y: undefined })).toBe(
      "?search=tape&low_stock=true&page=2",
    );
    expect(qs({})).toBe("");
  });
});
