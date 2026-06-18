import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, whoami } from "./api.js";

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
