// routes/customers.js
const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const { formatJalali } = require('../utils/jalali');

// ایجاد/به‌روزرسانی مشتری (بر اساس phone)
router.post('/', async (req, res) => {
  try {
    const { fullName, phone, address, altPhone, birthdate, city } = req.body;
    if (!fullName || !phone || !address) {
      return res.status(400).json({ ok: false, message: 'fullName, phone, address الزامی است.' });
    }

    // اگر از قبل هست، آپدیت کن ولی joinedAt را دست نزن
    let customer = await Customer.findOne({ phone });
    if (customer) {
      customer.fullName = fullName;
      customer.address = address;
      customer.altPhone = altPhone || customer.altPhone;
      customer.city = city || customer.city || 'اصفهان';
      customer.birthdate = birthdate ? new Date(birthdate) : customer.birthdate;
      await customer.save();
    } else {
      customer = await Customer.create({
        fullName, phone, address, altPhone, city: city || 'اصفهان',
        birthdate: birthdate ? new Date(birthdate) : undefined
      });
    }

    return res.json({
      ok: true,
      data: {
        id: customer._id,
        fullName: customer.fullName,
        phone: customer.phone,
        address: customer.address,
        altPhone: customer.altPhone,
        city: customer.city,
        birthdate: customer.birthdate ? formatJalali(customer.birthdate) : null,
        joinedAt: formatJalali(customer.joinedAt)
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: 'خطای سرور' });
  }
});

// جستجو با phone
router.get('/', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ ok:false, message:'phone لازم است' });
    const c = await Customer.findOne({ phone });
    if (!c) return res.status(404).json({ ok:false, message:'یافت نشد' });
    return res.json({
      ok:true,
      data:{
        id: c._id,
        fullName: c.fullName,
        phone: c.phone,
        address: c.address,
        altPhone: c.altPhone,
        city: c.city,
        birthdate: c.birthdate ? formatJalali(c.birthdate) : null,
        joinedAt: formatJalali(c.joinedAt)
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:'خطا' });
  }
});

module.exports = router;
