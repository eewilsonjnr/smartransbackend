import crypto from "crypto";

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { User } from "@prisma/client";

import { env } from "../config/env";

const SALT_ROUNDS = 10;
const REFRESH_TOKEN_BYTES = 40;
export const REFRESH_TOKEN_EXPIRY_DAYS = 30;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
export const DEFAULT_DRIVER_PASSWORD = "driver@1";
export const DEFAULT_ORG_STAFF_PASSWORD = "staff@1";
export const DEFAULT_CAR_OWNER_PASSWORD = "owner@1";
export const DEFAULT_AUTHORITY_PASSWORD = "authority@1";

export const defaultPasswordForRole = (role: User["role"]) => {
  if (role === "DRIVER") return DEFAULT_DRIVER_PASSWORD;
  if (role === "ORG_ADMIN" || role === "ORG_OFFICER") return DEFAULT_ORG_STAFF_PASSWORD;
  if (role === "CAR_OWNER") return DEFAULT_CAR_OWNER_PASSWORD;
  if (role === "AUTHORITY") return DEFAULT_AUTHORITY_PASSWORD;
  return generateRefreshToken().slice(0, 12);
};

export const hashPassword = (password: string) => bcrypt.hash(password, SALT_ROUNDS);

export const verifyPassword = (password: string, passwordHash: string) =>
  bcrypt.compare(password, passwordHash);

export const signUserToken = (user: Pick<User, "id" | "role">) =>
  jwt.sign({ role: user.role }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

export const generateRefreshToken = () =>
  crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("hex");

export const hashRefreshToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const refreshTokenExpiresAt = () => {
  const date = new Date();
  date.setDate(date.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
  return date;
};
