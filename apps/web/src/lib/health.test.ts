import { describe, expect, it } from "vitest";
import { apiTone, dbTone, parseApiHealth } from "@/lib/health";

const ok = {
  status: "ok",
  service: "arthasense-api",
  version: "0.1.0",
  database: { status: "ok", detail: null },
};

describe("parseApiHealth", () => {
  it("accepts a well-formed payload", () => {
    expect(parseApiHealth(ok)).toEqual(ok);
  });

  it("rejects malformed payloads instead of guessing", () => {
    expect(parseApiHealth(null)).toBeNull();
    expect(parseApiHealth({ status: "fine" })).toBeNull();
    expect(parseApiHealth({ ...ok, database: { status: "maybe" } })).toBeNull();
  });
});

describe("status tones", () => {
  it("marks an unreachable API as down and its DB as unknown", () => {
    const r = { reachable: false as const, error: "ECONNREFUSED" };
    expect(apiTone(r)).toBe("down");
    expect(dbTone(r)).toBe("unknown");
  });

  it("marks a degraded API with an unavailable DB", () => {
    const health = parseApiHealth({ ...ok, status: "degraded", database: { status: "unavailable" } });
    expect(health).not.toBeNull();
    const r = { reachable: true as const, health: health! };
    expect(apiTone(r)).toBe("warn");
    expect(dbTone(r)).toBe("down");
  });
});
