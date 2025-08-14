import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

/* ----------------------- Middlewares ----------------------- */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "1mb" }));

/* --------------------- MongoDB connect --------------------- */
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is missing. Put it in .env or Render env vars.");
}
mongoose
  .connect(MONGODB_URI, {
    dbName: "samiwater",
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    retryWrites: true,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((e) => console.error("❌ MongoDB error:", e.message));

/* ------------------------- Models -------------------------- */
// Customer
const customerSchema = new mongoose.Schema(
  {
    fullName:  { type: String, required: true, trim: true },
    phone:     { type: String, required: true, unique: true, trim: true },
    address:   { type: String, required: true, trim: true },
    altPhone:  { type: String, trim: true },
    // تاریخ تولد (اختیاری) — اگر در فرانت سه‌بخشی (روز/ماه/سال) داری، می‌تونی یا این Date رو ست کنی،
    // یا سه فیلد جداگانه هم در آینده اضافه کنیم.
    birthdate: { type: Date },
    joinedAt:  { type: Date, default: () => new Date() },
    city:      { type: String, default: "اصفهان", trim: true },
  },
  { timestamps: true }
);
const Customer = mongoose.model("Customer", customerSchema);

// Service Request
const requestSchema = new mongoose.Schema(
  {
    customer:   { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    phone:      { type: String, required: true, trim: true },
    address:    { type: String, required: true, trim: true },
    sourcePath: { type: String, default: "web_form", trim: true }, // مسیر ثبت (مثل: landing / urgent / app / ...)
    issueType:  { type: String, required: true, trim: true },      // نوع مشکل/خدمت
    invoiceCode:{ type: String, required: true, unique: true },

    // وضعیت درخواست
    status: {
      type: String,
      enum: ["open", "in_progress", "completed", "cancelled"],
      default: "open",
      index: true,
    },

    // برای درخواستِ مجدد (follow-up) که به فاکتور قبلی مرتبط است:
    isFollowUp:        { type: Boolean, default: false },
    relatedToInvoice:  { type: String, default: null }, // کد فاکتور قبلی

    createdAt:  { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);
requestSchema.index({ phone: 1, status: 1 });
const ServiceRequest = mongoose.model("ServiceRequest", requestSchema);

/* ------------------------ Helpers ------------------------- */
// تولید کُد فاکتور جلالی: [آخرِ رقم سال][ماهِ دو رقمی][سری ماه]
async function generateInvoiceCode() {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US-u-ca-persian", {
      year: "numeric",
      month: "2-digit",
      timeZone: "Asia/Tehran",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const lastDigitOfYear = parts.year.slice(-1); // مثلا 1404 -> "4"
  const month2 = parts.month; // "05"
  const prefix = `${lastDigitOfYear}${month2}`; // "405"

  // آخرین کدِ همین ماه
  const latest = await ServiceRequest.findOne({
    invoiceCode: new RegExp(`^${prefix}`),
  })
    .sort({ invoiceCode: -1 })
    .lean();

  let seq = 1;
  if (latest) {
    const prevSeq = parseInt(latest.invoiceCode.slice(prefix.length), 10);
    if (!isNaN(prevSeq)) seq = prevSeq + 1;
  }
  const seqStr = String(seq).padStart(2, "0"); // 01, 02, ...
  return `${prefix}${seqStr}`; // مثل 40501
}

const ACTIVE_STATUSES = ["open", "in_progress"]; // درخواستِ فعال (اجازه ثبتِ معمولی نمی‌دهیم)

/* ------------------------- Routes ------------------------- */
// صفحه اصلی
app.get("/", (req, res) => {
  res.send("SamiWater Backend is running ✅");
});

// سلامت
app.get("/api/health", (req, res) => {
  res.json({ ok: true, status: "SamiWater API is healthy" });
});

// تست اتصال به دیتابیس
const dbTestHandler = async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ ok: true, message: "Database connected successfully!" });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Database connection failed", details: String(error) });
  }
};
app.get("/test", dbTestHandler);
app.get("/api/test", dbTestHandler);

// راهنمای سریع API
app.get("/api", (req, res) => {
  res.json({
    message: "SamiWater API",
    routes: {
      health: "GET /api/health",
      test: "GET /api/test",
      customers_list: "GET /api/customers",
      customers_create: "POST /api/customers",
      customer_by_phone: "GET /api/customers/phone/:phone",

      requests_list: "GET /api/requests",
      requests_create: "POST /api/requests",
      requests_active_by_phone: "GET /api/requests/active/:phone",
      requests_update_status: "PATCH /api/requests/:invoiceCode/status",
    },
  });
});

/* ------------------------ Customers ------------------------ */
// ساخت مشتری
app.post("/api/customers", async (req, res) => {
  try {
    let { fullName, phone, address, altPhone, birthdate, city } = req.body;
    if (!fullName || !phone || !address) {
      return res.status(400).json({ error: "fullName, phone, address الزامی است." });
    }

    if (birthdate && typeof birthdate === "string") {
      const d = new Date(birthdate);
      if (!isNaN(d.getTime())) birthdate = d;
    }

    const exists = await Customer.findOne({ phone });
    if (exists) return res.status(409).json({ error: "این شماره قبلاً ثبت شده است." });

    const customer = await Customer.create({
      fullName, phone, address, altPhone, birthdate, city,
    });
    res.status(201).json(customer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// لیست مشتری‌ها
app.get("/api/customers", async (req, res) => {
  const list = await Customer.find().sort({ createdAt: -1 }).lean();
  res.json(list);
});

// دریافت مشتری با شماره
app.get("/api/customers/phone/:phone", async (req, res) => {
  const c = await Customer.findOne({ phone: req.params.phone }).lean();
  if (!c) return res.status(404).json({ error: "مشتری پیدا نشد." });
  res.json(c);
});

/* ------------------------- Requests ------------------------ */

// گرفتن درخواست فعال برای یک شماره (برای نمایش پیام به کاربر)
app.get("/api/requests/active/:phone", async (req, res) => {
  const phone = req.params.phone;
  const active = await ServiceRequest.findOne({
    phone,
    status: { $in: ACTIVE_STATUSES },
  }).sort({ createdAt: -1 }).lean();

  if (!active) return res.json({ ok: true, active: null });
  res.json({
    ok: true,
    active: {
      invoiceCode: active.invoiceCode,
      status: active.status,
      createdAt: active.createdAt,
      sourcePath: active.sourcePath,
      issueType: active.issueType,
    },
  });
});

// ثبت درخواست خدمت
// منطق:
// - اگر کاربر «follow-up» می‌فرستد (relatedToInvoice + isFollowUp=true) => اجازه ثبت می‌دهیم.
// - در غیر این صورت: اگر همین شماره درخواست فعال دارد => 409 برمی‌گردانیم.
app.post("/api/requests", async (req, res) => {
  try {
    const { phone, issueType, sourcePath, isFollowUp, relatedToInvoice } = req.body;
    if (!phone || !issueType) {
      return res.status(400).json({ error: "phone و issueType الزامی است." });
    }

    const customer = await Customer.findOne({ phone });
    if (!customer) {
      return res.status(404).json({ error: "ابتدا مشتری با این شماره ثبت شود." });
    }

    // اگر فالوآپ نیست، چک کن درخواست فعال وجود نداشته باشد
    if (!isFollowUp) {
      const active = await ServiceRequest.findOne({
        phone,
        status: { $in: ACTIVE_STATUSES },
      }).sort({ createdAt: -1 }).lean();

      if (active) {
        return res.status(409).json({
          error: "active_request_exists",
          message:
            "یک درخواست درحال انجام/تکمیل‌نشده دارید. لطفاً تا تعیین وضعیت صبر کنید یا با پشتیبانی تماس بگیرید.",
          invoiceCode: active.invoiceCode,
          status: active.status,
        });
      }
    }

    // اگر فالوآپ است، صحت relatedToInvoice را چک کن (اختیاری ولی بهتره)
    let relatedOk = null;
    if (isFollowUp && relatedToInvoice) {
      relatedOk = await ServiceRequest.findOne({ invoiceCode: relatedToInvoice }).lean();
      if (!relatedOk) {
        return res.status(400).json({
          error: "related_invoice_not_found",
          message: "کد فاکتور قبلی معتبر نیست.",
        });
      }
    }

    const invoiceCode = await generateInvoiceCode();
    const reqDoc = await ServiceRequest.create({
      customer: customer._id,
      phone: customer.phone,
      address: customer.address,
      sourcePath: sourcePath || "web_form",
      issueType,
      invoiceCode,
      isFollowUp: Boolean(isFollowUp),
      relatedToInvoice: relatedOk ? relatedOk.invoiceCode : relatedToInvoice || null,
      status: "open",
    });

    res.status(201).json(reqDoc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// تغییر وضعیت درخواست
// PATCH /api/requests/:invoiceCode/status  body: { status: "completed" | "in_progress" | "cancelled" }
app.patch("/api/requests/:invoiceCode/status", async (req, res) => {
  try {
    const { invoiceCode } = req.params;
    const { status } = req.body;

    if (!["open", "in_progress", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "وضعیت نامعتبر است." });
    }

    const updated = await ServiceRequest.findOneAndUpdate(
      { invoiceCode },
      { $set: { status } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: "درخواست با این کد پیدا نشد." });
    }

    res.json({ ok: true, request: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// لیست درخواست‌ها
app.get("/api/requests", async (req, res) => {
  const list = await ServiceRequest.find().sort({ createdAt: -1 }).lean();
  res.json(list);
});

/* -------------------- 404 & Error handlers -------------------- */
app.use((req, res, next) => {
  res.status(404).json({ error: "Route not found", path: req.originalUrl });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

/* ---------------------- Start server ---------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server listening on", PORT);
});
