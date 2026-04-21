import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("1d"),
  DEFAULT_SPEED_LIMIT: z.coerce.number().positive().default(80),

  // CORS — comma-separated list of allowed origins
  ALLOWED_ORIGINS: z.string().optional(),

  // SMS — Nalo Solutions
  ENABLE_SMS_NOTIFICATIONS: z.string().default("false"),
  NALO_API_URL: z.string().url().default("https://api.nalosolutions.com/sms/v1/text/single"),
  NALO_API_KEY: z.string().optional(),
  NALO_SENDER_ID: z.string().default("SmarTrans"),

  // Email — nodemailer / SMTP
  ENABLE_EMAIL_NOTIFICATIONS: z.string().default("false"),
  EMAIL_HOST: z.string().default("smtp.gmail.com"),
  EMAIL_PORT: z.coerce.number().int().positive().default(587),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default("SmarTrans <noreply@smartrans.com>"),

  // Push — Expo Push API
  ENABLE_PUSH_NOTIFICATIONS: z.string().default("false"),
  EXPO_ACCESS_TOKEN: z.string().optional(),
});

export const env = envSchema.parse(process.env);
