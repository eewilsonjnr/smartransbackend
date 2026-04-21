import type { ViolationSeverity, ViolationType } from "@prisma/client";

export const classifySpeedViolation = (
  speed: number,
  speedLimit: number,
  previousRecentViolations: number,
): { severity: ViolationSeverity; violationType: ViolationType } => {
  const overBy = speed - speedLimit;
  const ratio = speed / speedLimit;

  let severity: ViolationSeverity = "LOW";

  if (ratio >= 1.5 || overBy >= 40) {
    severity = "CRITICAL";
  } else if (ratio >= 1.3 || overBy >= 25) {
    severity = "HIGH";
  } else if (ratio >= 1.15 || overBy >= 10) {
    severity = "MEDIUM";
  }

  if (severity === "CRITICAL") {
    return { severity, violationType: "SEVERE_OVER_SPEEDING" };
  }

  if (previousRecentViolations >= 3) {
    return { severity, violationType: "REPEATED_OVER_SPEEDING" };
  }

  return { severity, violationType: "OVER_SPEEDING" };
};
