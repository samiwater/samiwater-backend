// routes/user.js
const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const ServiceRequest = require('../models/ServiceRequest');
const { formatJalali } = require('../utils/jalali');

// پروفایل کاربر (فعلاً بر اساس phone)
router.get('/me', async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ ok: false, message: 'phone لازم است' });

    const customer = await Customer.findOne({ phone });
    if (!customer) return res.status(404).json({ ok: false, message: 'مشتری یافت نشد' });

    return res.json({
      ok: true,
      data: {
        id: customer._id,
        fullName: customer.fullName,
        phone: customer.phone,
        altPhone: customer.altPhone,
        address: customer.address,
        city: customer.city,
        birthDate: customer.birthDate || null,
        createdAt: formatJalali(customer.createdAt)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'خطا در پروفایل' });
  }
});

// تاریخچه سرویس‌ها (از ServiceRequest)
router.get('/history', async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ ok: false, message: 'phone لازم است' });

    const rows = await ServiceRequest.find({ 'snapshot.phone': phone })
      .sort({ createdAt: -1 })
      .limit(50);

    const data = rows.map(r => ({
      id: r._id,
      invoiceCode: r.invoiceCode,
      issueType: r.issueType,
      status: r.status,
      createdAt: formatJalali(r.createdAt),
      scheduledAt: r.scheduledAt ? formatJalali(r.scheduledAt) : null
    }));

    res.json({ ok: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'خطا در تاریخچه' });
  }
});

// امتیاز و تخفیف (فعلاً نمونه ثابت)
router.get('/loyalty', async (req, res) => {
  return res.json({
    ok: true,
    data: {
      points: 230,
      ledger: [
        { date: '2025-04-08', delta: +50, reason: 'birthday' },
        { date: '2025-05-01', delta: -30, reason: 'coupon_use' }
      ]
    }
  });
});

// جشنواره‌ها (فعلاً نمونه ثابت)
router.get('/promotions', async (req, res) => {
  return res.json({
    ok: true,
    data: [
      { id: 'p1', title: 'طرح تعویض فیلتر تابستانه', desc: '۱۰٪ تخفیف تا ۳۰ شهریور', until: '2025-09-20' }
    ]
  });
});

// درخواست تغییر مشخصات
router.post('/change-request', async (req, res) => {
  try {
    const { phone, newData } = req.body;
    if (!phone) return res.status(400).json({ ok: false, message: 'phone لازم است' });

    // اینجا بهتره درخواست تغییر رو توی یه کلکشن جدا ذخیره کنیم تا مدیر تأیید کنه
    // فعلاً ساده برمی‌گردونیم
    return res.json({ ok: true, message: 'درخواست تغییر ثبت شد', newData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'خطا در تغییر مشخصات' });
  }
});

// درخواست فوری
router.post('/emergency', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ ok: false, message: 'phone لازم است' });

    return res.json({ ok: true, ticketId: 'EMG-' + Date.now() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'خطا در ثبت اضطراری' });
  }
});

module.exports = router;
