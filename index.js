// index.js — نسخه مینیمال برای تست SMS و OTP
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json());

// --- تنظیمات از env
const FARAZ_API_KEY = process.env.FARAZSMS_API_KEY || "";
const FARAZ_SENDER = process.env.FARAZSMS_SENDER || "";

// کمک‌متد ارسال پیامک با فراز
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
        sender: FARAZ_SENDER,         // مثل +98PRO یا شماره اختصاصی با 98+
        recipients: to,               // 09xxxxxxxxx
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

// --- Route تست ساده SMS
app.get("/test-sms", async (req, res) => {
  const to = (req.query.to || "").trim();
  const text = (req.query.text || "Test SamiWater").trim();
  if (!to) return res.status(400).json({ ok: false, error: "missing 'to'" });
  const r = await sendSms(to, text);
  const code = r.ok ? 200 : 500;
  res.status(code).json(r);
});

// --- OTP ساده با ذخیره موقتی در حافظه (برای تست)
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

  // برای تست: فقط اگر شماره‌ات شماره مدیر است role=admin برگردان
  const ADMIN_PHONE = "09384129843"; // اگر می‌خواهی عوضش کن
  const role = phone === ADMIN_PHONE ? "admin" : "user";
  otpStore.delete(phone);
  res.json({ ok: true, role });
});

// Root
app.get("/", (req, res) => {
  res.json({ ok: true, service: "SamiWater backend is up" });
});

// Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
