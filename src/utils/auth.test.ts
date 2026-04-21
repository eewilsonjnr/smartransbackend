import { describe, expect, it, beforeAll } from "vitest";

// Set required env vars before any module that calls env.parse() is imported
beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET = "test-secret-for-unit-tests-minimum-32-chars";
  process.env.JWT_EXPIRES_IN = "1h";
});

// Dynamic imports so env vars are set before module evaluation
const getAuth = async () => import("./auth.js");

describe("generateRefreshToken", () => {
  it("returns a non-empty hex string", async () => {
    const { generateRefreshToken } = await getAuth();
    expect(generateRefreshToken()).toMatch(/^[0-9a-f]+$/);
  });

  it("returns a different token each call", async () => {
    const { generateRefreshToken } = await getAuth();
    expect(generateRefreshToken()).not.toBe(generateRefreshToken());
  });

  it("returns 80 hex chars (40 random bytes)", async () => {
    const { generateRefreshToken } = await getAuth();
    expect(generateRefreshToken()).toHaveLength(80);
  });
});

describe("hashRefreshToken", () => {
  it("returns a 64-char hex string (SHA-256)", async () => {
    const { hashRefreshToken } = await getAuth();
    expect(hashRefreshToken("some-token")).toHaveLength(64);
  });

  it("is deterministic — same input yields same hash", async () => {
    const { hashRefreshToken } = await getAuth();
    const token = "test-token-abc";
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it("different inputs yield different hashes", async () => {
    const { hashRefreshToken } = await getAuth();
    expect(hashRefreshToken("token-a")).not.toBe(hashRefreshToken("token-b"));
  });
});

describe("refreshTokenExpiresAt", () => {
  it("sets expiry ~30 days from now", async () => {
    const { refreshTokenExpiresAt, REFRESH_TOKEN_EXPIRY_DAYS } = await getAuth();
    const before = Date.now();
    const expiry = refreshTokenExpiresAt().getTime();
    const after = Date.now();
    const expectedMs = REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    expect(expiry).toBeGreaterThanOrEqual(before + expectedMs - 1000);
    expect(expiry).toBeLessThanOrEqual(after + expectedMs + 1000);
  });
});

describe("lockout constants", () => {
  it("MAX_FAILED_LOGINS is 5", async () => {
    const { MAX_FAILED_LOGINS } = await getAuth();
    expect(MAX_FAILED_LOGINS).toBe(5);
  });

  it("LOCKOUT_MINUTES is 15", async () => {
    const { LOCKOUT_MINUTES } = await getAuth();
    expect(LOCKOUT_MINUTES).toBe(15);
  });
});
