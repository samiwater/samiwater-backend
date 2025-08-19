// utils/sms.js
import fetch from "node-fetch";

const API = process.env.FARAZSMS_BASEURL || "https://sms.farazsms.com/api";
const API_KEY = process.env.FARAZSMS_API_KEY;
const SENDER = process.env.FARAZSMS_SENDER;

/**
 * ارسال پیامک ساده (برای OTP)
 * @param {string} to 09xxxxxxxxx
 * @param {string} text متن پیام
 */
export async function sendSMS(to, text) {
  if (!API_KEY || !SENDER) {
    throw new Error("SMS env vars missing");
  }
  // بعضی پنل‌ها گیر میدن به 0 اول؛ اگر لازم شد به 98 تبدیل کن
  const recipients = to.trim();

  const resp = await fetch(`${API}/v1/sms/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      sender: SENDER,
      recipients: [recipients],
      message: text,
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`SMS send failed: ${JSON.stringify(data)}`);
  }
  return data;
}
