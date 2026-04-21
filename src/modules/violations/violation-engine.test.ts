import { describe, expect, it } from "vitest";
import { classifySpeedViolation } from "./violation-engine";

describe("classifySpeedViolation", () => {
  describe("severity — LOW", () => {
    it("returns LOW when just above limit", () => {
      const result = classifySpeedViolation(85, 80, 0);
      expect(result.severity).toBe("LOW");
    });

    it("returns LOW when overBy < 10", () => {
      const result = classifySpeedViolation(89, 80, 0);
      expect(result.severity).toBe("LOW");
      expect(result.violationType).toBe("OVER_SPEEDING");
    });
  });

  describe("severity — MEDIUM", () => {
    it("returns MEDIUM when overBy >= 10", () => {
      const result = classifySpeedViolation(90, 80, 0);
      expect(result.severity).toBe("MEDIUM");
    });

    it("returns MEDIUM when ratio >= 1.15", () => {
      const result = classifySpeedViolation(92, 80, 0);
      expect(result.severity).toBe("MEDIUM");
    });
  });

  describe("severity — HIGH", () => {
    it("returns HIGH when overBy >= 25", () => {
      const result = classifySpeedViolation(105, 80, 0);
      expect(result.severity).toBe("HIGH");
    });

    it("returns HIGH when ratio >= 1.3", () => {
      const result = classifySpeedViolation(104, 80, 0);
      expect(result.severity).toBe("HIGH");
    });
  });

  describe("severity — CRITICAL", () => {
    it("returns CRITICAL when overBy >= 40", () => {
      const result = classifySpeedViolation(120, 80, 0);
      expect(result.severity).toBe("CRITICAL");
      expect(result.violationType).toBe("SEVERE_OVER_SPEEDING");
    });

    it("returns CRITICAL when ratio >= 1.5", () => {
      const result = classifySpeedViolation(120, 80, 0);
      expect(result.severity).toBe("CRITICAL");
    });

    it("CRITICAL always maps to SEVERE_OVER_SPEEDING regardless of repeat count", () => {
      const result = classifySpeedViolation(140, 80, 10);
      expect(result.violationType).toBe("SEVERE_OVER_SPEEDING");
    });
  });

  describe("violationType — REPEATED_OVER_SPEEDING", () => {
    it("returns REPEATED when previousViolations >= 3 and severity is not CRITICAL", () => {
      const result = classifySpeedViolation(85, 80, 3);
      expect(result.violationType).toBe("REPEATED_OVER_SPEEDING");
    });

    it("returns REPEATED when previousViolations >= 3 with MEDIUM severity", () => {
      const result = classifySpeedViolation(95, 80, 5);
      expect(result.violationType).toBe("REPEATED_OVER_SPEEDING");
    });

    it("does NOT return REPEATED when previousViolations < 3", () => {
      const result = classifySpeedViolation(85, 80, 2);
      expect(result.violationType).toBe("OVER_SPEEDING");
    });
  });

  describe("edge cases", () => {
    it("handles zero previous violations", () => {
      const result = classifySpeedViolation(100, 80, 0);
      expect(result.violationType).toBe("OVER_SPEEDING");
    });

    it("handles high speed limit — 10 over 100 km/h is MEDIUM", () => {
      const result = classifySpeedViolation(110, 100, 0);
      expect(result.severity).toBe("MEDIUM");
    });

    it("ratio exactly 1.5 is CRITICAL", () => {
      const result = classifySpeedViolation(120, 80, 0);
      expect(result.severity).toBe("CRITICAL");
    });
  });
});
