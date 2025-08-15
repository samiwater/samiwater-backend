import express from "express";
import axios from "axios";

const router = express.Router();

// روت تست برای ارسال پیامک
router.get("/test-sms", async (req, res) => {
  try {
    const response = await axios.post(
      "https://api2.ippanel.com/api/v1/sms/send",
      {
        sender: "+98PRO", // شماره خط فراز که انتخاب کردی
        recipients: ["09xxxxxxxxx"], // شماره تست
        message: "این یک پیام تستی از سامی واتر است ✅",
      },
      {
        headers: {
          "Content-Type": "application/json",
          "apikey": process.env.FARAZ_SMS_API_KEY, // همون کلیدی که تو Render گذاشتی
        },
      }
    );

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

export default router;
