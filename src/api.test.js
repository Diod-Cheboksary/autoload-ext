import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, safeInt, whoami } from "./api.js";

afterEach(() => { vi.unstubAllGlobals(); });

describe("apiRequest", () => {
  it("sends an apiFetch message and parses JSON text", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ status: 200, text: '{"count":3}' });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const r = await apiRequest("GET", "https://e133.tech/barcode/api/receipts/queue");
    expect(sendMessage).toHaveBeenCalledWith({
      type: "apiFetch", method: "GET",
      url: "https://e133.tech/barcode/api/receipts/queue", body: undefined,
    });
    expect(r).toEqual({ status: 200, body: { count: 3 } });
  });

  it("returns status 0 when the service worker rejects", async () => {
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockRejectedValue(new Error("boom")) } });
    const r = await apiRequest("GET", "u");
    expect(r.status).toBe(0);
    expect(r.body).toBeNull();
  });

  it("keeps status but body null on non-JSON text (e.g. login HTML)", async () => {
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue({ status: 401, text: "<html>login</html>" }) } });
    expect(await apiRequest("GET", "u")).toEqual({ status: 401, body: null });
  });
});

describe("whoami", () => {
  it("ok=true when 200 and authenticated", async () => {
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue({ status: 200, text: '{"authenticated":true,"user":"a@b"}' }) } });
    expect(await whoami()).toEqual({ ok: true, status: 200, user: "a@b" });
  });

  it("ok=false on 401", async () => {
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue({ status: 401, text: "" }) } });
    const r = await whoami();
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
});

describe("403 branch resolution normalization (tg-auth-0kx)", () => {
  it("403 branch_selection_required → понятная строка в detail", async () => {
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue({
      status: 403, text: JSON.stringify({ detail: {
        code: "branch_selection_required", detail: "нужен выбор",
        branches: [{ slug: "prg" }, { slug: "nck" }] } }) }) } });
    const r = await apiRequest("GET", "u");
    expect(r.status).toBe(403);
    expect(typeof r.body.detail).toBe("string");
    expect(r.body.detail).toMatch(/выберите филиал/i);
  });

  it("403 no_branch → сообщение про доступ", async () => {
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue({
      status: 403, text: JSON.stringify({ detail: { code: "no_branch", branches: [] } }) }) } });
    const r = await apiRequest("GET", "u");
    expect(r.body.detail).toMatch(/нет доступа/i);
  });

  it("не-403 ответ оставляет detail нетронутым", async () => {
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue({
      status: 404, text: JSON.stringify({ detail: "не найдено" }) }) } });
    const r = await apiRequest("GET", "u");
    expect(r.body.detail).toBe("не найдено");
  });
});

describe("whoami branch (tg-auth-0kx)", () => {
  it("отдаёт активный филиал (branch_name приоритетнее slug)", async () => {
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue({
      status: 200, text: JSON.stringify({ authenticated: true, user: "a@b",
        branch: "nck", branch_name: "НЧК" }) }) } });
    const r = await whoami();
    expect(r.branch).toBe("НЧК");
  });

  it("branch = undefined когда филиал не определён", async () => {
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue({
      status: 200, text: JSON.stringify({ authenticated: true, user: "a@b" }) }) } });
    const r = await whoami();
    expect(r.branch).toBeFalsy();
  });
});

describe("safeInt", () => {
  it("returns finite numbers unchanged", () => {
    expect(safeInt(0)).toBe(0);
    expect(safeInt(42)).toBe(42);
  });

  it("coerces numeric strings", () => {
    expect(safeInt("7")).toBe(7);
  });

  it("returns 0 for HTML/script payloads (XSS guard)", () => {
    expect(safeInt('<img src=x onerror=alert(1)>')).toBe(0);
    expect(safeInt('<script>alert(1)</script>')).toBe(0);
  });

  it("returns 0 for non-numeric / non-finite / nullish", () => {
    expect(safeInt(undefined)).toBe(0);
    expect(safeInt(null)).toBe(0);
    expect(safeInt(NaN)).toBe(0);
    expect(safeInt(Infinity)).toBe(0);
    expect(safeInt({})).toBe(0);
    expect(safeInt("abc")).toBe(0);
  });
});
