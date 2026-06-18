import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./background.js";

afterEach(() => { vi.unstubAllGlobals(); });

describe("apiFetch", () => {
  it("does a GET with credentials:'include' and returns {status,text}", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: async () => '{"ok":true}' });
    vi.stubGlobal("fetch", fetchMock);
    const r = await apiFetch({ method: "GET", url: "https://e133.tech/barcode/api/whoami" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://e133.tech/barcode/api/whoami",
      { method: "GET", credentials: "include" },
    );
    expect(r).toEqual({ status: 200, text: '{"ok":true}' });
  });

  it("serialises a JSON body for POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: async () => "{}" });
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch({ method: "POST", url: "u", body: { supplier: "partkom", identifier: "55" } });
    expect(fetchMock).toHaveBeenCalledWith("u", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplier: "partkom", identifier: "55" }),
    });
  });
});
