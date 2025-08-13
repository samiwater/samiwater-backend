// models/ServiceRequest.js
const mongoose = require('mongoose');

const ServiceRequestSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },

    // اسنپ‌شات از اطلاعات مشتری (برای گزارش بعدی)
    snapshot: {
      fullName: String,
      phone: String,
      altPhone: String,
      address: String,
      city: String
    },

    sourcePath: {
      type: String,
      enum: ['web_form', 'phone_call', 'whatsapp', 'technician', 'other'],
      default: 'web_form'
    },

    issueType: {
      type: String,
      enum: ['install', 'maintenance', 'repair', 'connect', 'visit', 'other'],
      default: 'maintenance'
    },

    invoiceCode: { type: String, required: true, index: true }, // مثل 40501
    status: {
      type: String,
      enum: ['pending', 'scheduled', 'in_progress', 'done', 'canceled'],
      default: 'pending'
    },

    scheduledAt: { type: Date }, // اختیاری
    resultNote: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ServiceRequest', ServiceRequestSchema);
