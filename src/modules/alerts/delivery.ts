import axios from "axios";
import nodemailer from "nodemailer";
import type { DeliveryChannel } from "@prisma/client";

import { env } from "../../config/env";

export type DeliveryPayload = {
  recipientUserId: string;
  channel: DeliveryChannel;
  message: string;
  phone?: string | null;
  email?: string | null;
  pushToken?: string | null;
};

export type DeliveryResult = {
  success: boolean;
  error?: string;
};

// ── Phone normalisation ──────────────────────────────────────────────────────
// Converts Ghanaian numbers to international format (233XXXXXXXXX)
function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0") && digits.length === 10) return "233" + digits.slice(1);
  return digits;
}

// ── Email transporter (lazy-initialised) ────────────────────────────────────
let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: env.EMAIL_HOST,
      port: env.EMAIL_PORT,
      secure: env.EMAIL_PORT === 465,
      auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASSWORD,
      },
      tls: { rejectUnauthorized: env.NODE_ENV === "production" },
    });
  }
  return _transporter;
}

// ── SMS via Nalo Solutions ───────────────────────────────────────────────────
async function sendSms(phone: string, message: string): Promise<DeliveryResult> {
  if (env.ENABLE_SMS_NOTIFICATIONS !== "true") {
    return { success: false, error: "SMS notifications disabled." };
  }

  if (!env.NALO_API_KEY) {
    return { success: false, error: "NALO_API_KEY not configured." };
  }

  if (!phone) {
    return { success: false, error: "No phone number." };
  }

  try {
    const response = await axios.post(
      env.NALO_API_URL,
      {
        key: env.NALO_API_KEY,
        msisdn: normalisePhone(phone),
        message,
        sender_id: env.NALO_SENDER_ID,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 10_000,
      },
    );

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Nalo SMS failed: ${msg}` };
  }
}

// ── Email via SMTP (nodemailer) ──────────────────────────────────────────────
async function sendEmail(email: string, message: string): Promise<DeliveryResult> {
  if (env.ENABLE_EMAIL_NOTIFICATIONS !== "true") {
    return { success: false, error: "Email notifications disabled." };
  }

  if (!env.EMAIL_USER || !env.EMAIL_PASSWORD) {
    return { success: false, error: "Email credentials not configured." };
  }

  if (!email) {
    return { success: false, error: "No email address." };
  }

  try {
    await getTransporter().sendMail({
      from: env.EMAIL_FROM,
      to: email,
      subject: "SmarTrans Alert",
      text: message,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <div style="background:#0D1F17;padding:16px 20px;border-radius:8px 8px 0 0">
            <span style="color:#22C55E;font-size:18px;font-weight:900;letter-spacing:-0.5px">SmarTrans</span>
          </div>
          <div style="background:#f9fbfa;padding:24px;border:1px solid #dbe5df;border-radius:0 0 8px 8px">
            <p style="color:#17211d;font-size:15px;line-height:1.6;margin:0">${message.replace(/\n/g, "<br>")}</p>
          </div>
          <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:16px">
            SmarTrans Connect — automated alert. Do not reply.
          </p>
        </div>
      `,
    });

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Email failed: ${msg}` };
  }
}

// ── Push via Expo Push API ───────────────────────────────────────────────────
async function sendPush(pushToken: string, message: string): Promise<DeliveryResult> {
  if (env.ENABLE_PUSH_NOTIFICATIONS !== "true") {
    return { success: false, error: "Push notifications disabled." };
  }

  if (!pushToken) {
    return { success: false, error: "No push token." };
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (env.EXPO_ACCESS_TOKEN) {
      headers["Authorization"] = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
    }

    const response = await axios.post(
      "https://exp.host/--/api/v2/push/send",
      {
        to: pushToken,
        title: "SmarTrans",
        body: message,
        sound: "default",
        priority: "high",
      },
      { headers, timeout: 10_000 },
    );

    const data = response.data as { data?: { status?: string; message?: string } };
    if (data?.data?.status === "error") {
      return { success: false, error: data.data.message ?? "Push send error." };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Push failed: ${msg}` };
  }
}

// ── Public dispatcher ────────────────────────────────────────────────────────
export async function deliverAlert(payload: DeliveryPayload): Promise<DeliveryResult> {
  switch (payload.channel) {
    case "SMS":
      return sendSms(payload.phone ?? "", payload.message);
    case "EMAIL":
      return sendEmail(payload.email ?? "", payload.message);
    case "PUSH":
      return sendPush(payload.pushToken ?? "", payload.message);
    case "IN_APP":
    case "DASHBOARD":
      return { success: true };
    default:
      return { success: false, error: `Unknown channel: ${payload.channel}` };
  }
}
