// routes/user.js
import express from "express";
import Customer from "../models/Customer.js"; // بعدا این مدل رو می‌سازیم

const router = express.Router();

/**
 * ثبت‌نام مشتری جدید
 * POST /api/user/register
 */
router.post("/register", async (req, res) => {
  try {
    const { fullName, phone, altPhone, address, city, birthday } = req.body;

    if (!phone) {
      return res.status(400).json({ ok: false, message: "شماره موبایل الزامی است" });
    }

    // بررسی تکراری نبودن شماره
    let existing = await Customer.findOne({ phone });
    if (existing) {
      return res.status(400).json({ ok: false, message: "این شماره قبلا ثبت شده است" });
    }

    const newCustomer = await Customer.create({
      fullName,
      phone,
      altPhone,
      address,
      city,
      birthday,
      createdAt: new Date()
    });

    res.json({ ok: true, data: newCustomer });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ ok: false, message: "خطای سرور" });
  }
});

/**
 * دریافت پروفایل مشتری
 * GET /api/user/me/:phone
 */
router.get("/me/:phone", async (req, res) => {
  try {
    const { phone } = req.params;
    const customer = await Customer.findOne({ phone });

    if (!customer) {
      return res.status(404).json({ ok: false, message: "کاربر یافت نشد" });
    }

    res.json({ ok: true, data: customer });
  } catch (err) {
    console.error("Fetch user error:", err);
    res.status(500).json({ ok: false, message: "خطای سرور" });
  }
});

export default router;
