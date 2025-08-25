// index.js — SamiWater backend (ESM)
// - SMS/OTP تست مثل قبل
// - رزرو بازه‌های 2ساعته (09–21)
// - اتصال به MongoDB و ساخت ایندکس یونیک اسلات‌ها

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";

import reservationsRouter from "./routes/reservations.js"; // NEW

dotenv.config();

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "PATCH", "OPTIONS"] }));
app.use(express.json());

// ======= ENV
const FARAZ_API_KEY = process.env.FARAZSMS_API_KEY || "";
const FARAZ_SENDER = process.env.FARAZSMS_SENDER || "";
const MONGODB_URI = process.env.MONGODB_URI || "";
const PORT = process.env.PORT || 10000;

// ======= MongoDB
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is required");
  process.exit(1);
}

// اتصال و ساخت ایندکس‌ها (برای قفل‌کردن بازه‌ها)
await mongoose.connect(MONGODB_URI, { autoIndex: true }).catch((e) => {
  console.error("❌ Mongo connect error:", e);
  process.exit(1);
});
console.log("✅ Mongo connected");

// ======= کمک‌متد ارسال SMS با Faraz
async function sendSms(to, text) {
  if (!FARAZ_API_KEY || !FARAZ_SENDER) {
    return { ok: false, error: "SMS env vars missing" };
  }
  try {
    const resp = await fetch("https://api.farazsms.com/v1/sms/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": FARAZ_API_KEY,
      },
      body: JSON.stringify({
        sender: FARAZ_SENDER, // مثل +98... یا شناسه فرستنده
        recipients: to,       // 09xxxxxxxxx
        message: text,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, error: "SMS send failed", details: data };
    return { ok: true, provider: "farazsms", data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ======= Route تست ساده SMS
app.get("/test-sms", async (req, res) => {
  const to = (req.query.to || "").trim();
  const text = (req.query.text || "Test SamiWater").trim();
  if (!to) return res.status(400).json({ ok: false, error: "missing 'to'" });
  const r = await sendSms(to, text);
  const code = r.ok ? 200 : 500;
  res.status(code).json(r);
});

// ======= OTP ساده (in-memory) برای تست
const otpStore = new Map(); // key: phone, value: { code, exp }
function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

app.get("/auth/request-otp", async (req, res) => {
  const phone = (req.query.phone || "").trim();
  if (!phone) return res.status(400).json({ ok: false, error: "missing phone" });

  const code = genCode();
  const exp = Date.now() + 2 * 60 * 1000; // 2 دقیقه
  otpStore.set(phone, { code, exp });

  const smsText = `کد تایید شما: ${code}\nSamiWater`;
  const r = await sendSms(phone, smsText);
  if (!r.ok) return res.status(500).json(r);
  res.json({ ok: true, message: "otp sent" });
});

app.get("/auth/verify-otp", (req, res) => {
  const phone = (req.query.phone || "").trim();
  const code = (req.query.code || "").trim();
  const item = otpStore.get(phone);
  if (!item) return res.status(400).json({ ok: false, error: "no otp" });
  if (Date.now() > item.exp) return res.status(400).json({ ok: false, error: "expired" });
  if (item.code !== code) return res.status(400).json({ ok: false, error: "invalid" });

  const ADMIN_PHONE = "09384129843"; // دلخواه
  const role = phone === ADMIN_PHONE ? "admin" : "user";
  otpStore.delete(phone);
  res.json({ ok: true, role });
});

// ======= Health
app.get("/", (req, res) => {
  res.json({ ok: true, service: "SamiWater backend is up", tz: process.env.TZ || "unset" });
});

// ======= رزرو بازه‌های 2ساعته (09–21) — NEW
app.use("/reservations", reservationsRouter);

// ======= Start
app.listen(PORT, () => {
  console.log(`🚀 Server listening on ${PORT}`);
  console.log("🕒 TZ hint:", process.env.TZ || "TZ not set (recommend TZ=Asia/Tehran)");
});
