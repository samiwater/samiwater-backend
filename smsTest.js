// smsTest.js
import { Router } from "express";
import fetch from "node-fetch";

const router = Router();

/**
 * GET /test-sms?to=09xxxxxxxx&text=سلام
 * env باید باشه:
 * FARAZSMS_API_KEY  , FARAZSMS_SENDER
 */
router.get("/test-sms", async (req, res) => {
  try {
    const apiKey = process.env.FARAZSMS_API_KEY;
    const sender = process.env.FARAZSMS_SENDER;
    const to = (req.query.to || "").trim();
    const text = (req.query.text || "تست ارسال پیامک سامی‌واتر").trim();

    if (!apiKey || !sender) {
      return res.status(500).json({ ok: false, error: "SMS env vars missing" });
    }
    if (!to) {
      return res.status(400).json({ ok: false, error: "شماره گیرنده الزامی‌ست." });
    }

    const resp = await fetch("https://api.farazsms.com/v1/sms/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        sender,
        recipients: [to],
        message: text
      })
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return res.status(500).json({ ok: false, error: "SMS send failed", details: data });
    }
    res.json({ ok: true, provider: "farazsms", data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
