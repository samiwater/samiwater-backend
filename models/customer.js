// models/Customer.js
const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, index: true }, // یونیک
    address: { type: String, required: true },
    altPhone: { type: String }, // اختیاری
    birthdate: { type: Date },   // اختیاری - میلادی ذخیره می‌کنیم
    city: { type: String, default: 'اصفهان' },
    joinedAt: { type: Date, default: Date.now } // تاریخ عضویت (ثبت مشخصات)
  },
  { timestamps: true }
);

// اگر رکورد موجود ویرایش شد، joinedAt را دست‌نخورده نگه داریم.
CustomerSchema.pre('save', function (next) {
  if (!this.isNew) {
    this.markModified('joinedAt'); // اطمینان از عدم تغییر
  }
  next();
});

module.exports = mongoose.model('Customer', CustomerSchema);
