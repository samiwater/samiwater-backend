// models/Reservation.js (ESM)
import mongoose from "mongoose";

const ReservationSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    serviceType: { type: String, required: true },
    details: { type: String },

    // تاریخ میلادی YYYY-MM-DD (بر اساس Asia/Tehran)
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },

    // بازه‌های 2ساعته از 9 تا 21
    window: {
      type: String,
      required: true,
      enum: ["09-11", "11-13", "13-15", "15-17", "17-19", "19-21"],
    },

    source: { type: String, enum: ["self", "operator"], default: "self" },

    status: {
      type: String,
      enum: ["pending", "confirmed", "done", "cancelled"],
      default: "pending",
      index: true,
    },

    timezone: { type: String, default: "Asia/Tehran" },

    assigned: {
      technicianId: { type: mongoose.Schema.Types.ObjectId, ref: "Technician" },
      note: { type: String },
    },
  },
  { timestamps: true }
);

// فقط یک رزرو فعال برای هر (date, window)
ReservationSchema.index(
  { date: 1, window: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["pending", "confirmed"] } },
    name: "uniq_active_slot_per_day",
  }
);

const Reservation = mongoose.model("Reservation", ReservationSchema);
export default Reservation;
