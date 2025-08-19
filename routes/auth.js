// routes/auth.js
import { Router } from "express";
import { sendSMS } from "../utils/sms.js";

const router = Router();

// فقط این شماره فعلاً مجازه مدیر باشه:
const ADMIN_PHONE = "09384129843";

// حافظه موقت برای OTP (می‌تونی بعداً بذاری تو Mongo)
const otpStore = new Map(); // key: phone, value: { code, exp: Date }

/**
 * GET /auth/request-otp?phone=09xxxxxxxxx
 * - اگر شماره = مدیر باشد: کد OTP می‌فرستیم
 * - در غیر این صورت فعلاً ورود مشتریان بسته است (403)
 */
router.get("/request-otp", async (req, res) => {
  try {
    const phone = (req.query.phone || "").trim();
    if (!/^09\d{9}$/.test(phone)) {
      return res.status(400).json({ ok: false, error: "شماره معتبر نیست" });
    }

    // فعلاً فقط مدیر
    if (phone !== ADMIN_PHONE) {
      return res
        .status(403)
        .json({ ok: false, error: "ورود مشتریان فعلاً غیرفعال است" });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6رقمی
    const exp = Date.now() + 2 * 60 * 1000; // 2 دقیقه اعتبار
    otpStore.set(phone, { code, exp });

    const text = `کد ورود سامی‌واتر: ${code}\nاین کد تا ۲ دقیقه معتبر است.`;
    await sendSMS(phone, text);

    res.json({ ok: true, sent: true, ttlSec: 120 });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * GET /auth/verify-otp?phone=09xxxxxxxxx&code=xxxxxx
 * - اگر درست و معتبر بود: نقش = admin برمی‌گردانیم
 */
router.get("/verify-otp", (req, res) => {
  const phone = (req.query.phone || "").trim();
  const code = (req.query.code || "").trim();

  const item = otpStore.get(phone);
  if (!item) return res.status(400).json({ ok: false, error: "کدی ثبت نشده" });
  if (Date.now() > item.exp) {
    otpStore.delete(phone);
    return res.status(400).json({ ok: false, error: "کد منقضی شده" });
  }
  if (item.code !== code) {
    return res.status(400).json({ ok: false, error: "کد نادرست است" });
  }

  otpStore.delete(phone);
  // فعلاً فقط مدیر داریم
  res.json({ ok: true, role: phone === ADMIN_PHONE ? "admin" : "user" });
});

export default router;
