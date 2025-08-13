// routes/requests.js
const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const ServiceRequest = require('../models/ServiceRequest');
const Counter = require('../models/Counter');
const { getJalaliYearDigitAndMonth, formatJalali } = require('../utils/jalali');

// تولید اتومیک شماره ماه (بدون تداخل)
async function nextInvoiceSeq() {
  const { yearDigit, month } = getJalaliYearDigitAndMonth(new Date());
  const ymKey = `${yearDigit}${month}`; // مثلا "405"
  const counter = await Counter.findOneAndUpdate(
    { ymKey },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return { ymKey, seq: counter.seq };
}

router.post('/', async (req, res) => {
  try {
    const { phone, sourcePath, issueType, scheduledAt } = req.body;
    if (!phone) return res.status(400).json({ ok:false, message:'phone لازم است' });

    const customer = await Customer.findOne({ phone });
    if (!customer) return res.status(404).json({ ok:false, message:'مشتری یافت نشد' });

    // کد فاکتور
    const { ymKey, seq } = await nextInvoiceSeq();
    // شماره سفارش در ماه: حداقل دو رقمی
    const orderStr = String(seq).padStart(2, '0');
    const invoiceCode = `${ymKey}${orderStr}`; // مثل 40501

    const reqDoc = await ServiceRequest.create({
      customer: customer._id,
      snapshot: {
        fullName: customer.fullName,
        phone: customer.phone,
        altPhone: customer.altPhone,
        address: customer.address,
        city: customer.city
      },
      sourcePath: sourcePath || 'web_form',
      issueType: issueType || 'maintenance',
      invoiceCode,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined
    });

    return res.json({
      ok:true,
      data:{
        id: reqDoc._id,
        invoiceCode: reqDoc.invoiceCode,
        customer: reqDoc.snapshot,
        issueType: reqDoc.issueType,
        sourcePath: reqDoc.sourcePath,
        status: reqDoc.status,
        createdAt: formatJalali(reqDoc.createdAt),
        scheduledAt: reqDoc.scheduledAt ? formatJalali(reqDoc.scheduledAt) : null
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:'خطا' });
  }
});

// لیست/جستجو
router.get('/', async (req, res) => {
  try {
    const { phone, status } = req.query;
    const q = {};
    if (phone) q['snapshot.phone'] = phone;
    if (status) q.status = status;

    const rows = await ServiceRequest.find(q).sort({ createdAt: -1 }).limit(100);
    const data = rows.map(r => ({
      id: r._id,
      invoiceCode: r.invoiceCode,
      customer: r.snapshot,
      issueType: r.issueType,
      sourcePath: r.sourcePath,
      status: r.status,
      createdAt: formatJalali(r.createdAt),
      scheduledAt: r.scheduledAt ? formatJalali(r.scheduledAt) : null
    }));
    res.json({ ok:true, data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:'خطا' });
  }
});

module.exports = router;
