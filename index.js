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
// مشتری
const customerSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone:   { type: String, required: true, unique: true, trim: true },
    address: { type: String, required: true, trim: true },
    altPhone:{ type: String, trim: true },
    birthdate:{ type: Date },                                  // اختیاری
    joinedAt:{ type: Date, default: () => new Date() },        // تاریخ عضویت
    city:    { type: String, default: "اصفهان", trim: true },

    // 🔹 جدید: درصد تخفیف مشتری (۰ تا ۱۰۰)
    discountPercent: { type: Number, min: 0, max: 100, default: 0 },
  },
  { timestamps: true }
);
const Customer = mongoose.model("Customer", customerSchema);

// درخواست خدمت
const requestSchema = new mongoose.Schema(
  {
    customer:   { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    phone:      { type: String, required: true, trim: true },
    address:    { type: String, required: true, trim: true },
    sourcePath: { type: String, default: "web_form", trim: true }, // مسیر ثبت
    issueType:  { type: String, required: true, trim: true },      // نوع مشکل/خدمت

    // کد فاکتور یکتا
    invoiceCode:{ type: String, required: true, unique: true },

    // 🔹 وضعیت درخواست (برای پنل مدیریت)
    status:     { type: String, enum: ["pending","assigned","done","canceled"], default: "pending" },

    createdAt:  { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);
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
  const month2 = parts.month;                   // "05"
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
  return `${prefix}${seqStr}`;                 // مثل 40501
}

/* ------------------------- Routes ------------------------- */
// صفحه اصلی
app.get("/", (req, res) => {
  res.send("SamiWater Backend is running ✅");
});

// سلامت
app.get("/api/health", (req, res) => {
  res.json({ ok: true, status: "SamiWater API is healthy" });
});

// تست اتصال DB
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

      admin_requests_list: "GET /api/admin/requests",
      admin_requests_status: "PATCH /api/admin/requests/:id/status",
      admin_customers_list: "GET /api/admin/customers",
      admin_customer_discount: "PATCH /api/admin/customers/:id/discount",
      admin_stats: "GET /api/admin/stats",
    },
  });
});

/* ---------------------- Public: Customers ---------------------- */
// ساخت مشتری
app.post("/api/customers", async (req, res) => {
  try {
    let { fullName, phone, address, altPhone, birthdate, city } = req.body;
    if (!fullName || !phone || !address) {
      return res.status(400).json({ error: "fullName, phone, address الزامی است." });
    }

    // اگر birthdate رشته باشد، تبدیل به Date کن
    if (birthdate && typeof birthdate === "string") {
      const d = new Date(birthdate);
      if (!isNaN(d.getTime())) birthdate = d;
    }

    const exists = await Customer.findOne({ phone });
    if (exists) return res.status(409).json({ error: "این شماره قبلاً ثبت شده است." });

    const customer = await Customer.create({
      fullName,
      phone,
      address,
      altPhone,
      birthdate,
      city,
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

/* ---------------------- Public: Requests ---------------------- */
// ثبت درخواست خدمت (از روی مشتریِ موجود)
app.post("/api/requests", async (req, res) => {
  try {
    const { phone, issueType, sourcePath } = req.body;
    if (!phone || !issueType) {
      return res.status(400).json({ error: "phone و issueType الزامی است." });
    }

    const customer = await Customer.findOne({ phone });
    if (!customer) {
      return res.status(404).json({ error: "ابتدا مشتری با این شماره ثبت شود." });
    }

    const invoiceCode = await generateInvoiceCode();
    const reqDoc = await ServiceRequest.create({
      customer: customer._id,
      phone: customer.phone,
      address: customer.address,
      sourcePath: sourcePath || "web_form",
      issueType,
      invoiceCode,
      status: "pending",
    });

    res.status(201).json(reqDoc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// لیست درخواست‌ها
app.get("/api/requests", async (req, res) => {
  const list = await ServiceRequest.find().sort({ createdAt: -1 }).lean();
  res.json(list);
});

/* ---------------------- Admin: Requests ---------------------- */
// لیست درخواست‌ها (برای داشبورد)
app.get("/api/admin/requests", async (req, res) => {
  try {
    const limit = Math.min( Number(req.query.limit || 100), 500 );
    const list = await ServiceRequest.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// تغییر وضعیت درخواست
app.patch("/api/admin/requests/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // pending | assigned | done | canceled
    if (!["pending","assigned","done","canceled"].includes(status)) {
      return res.status(400).json({ error: "وضعیت نامعتبر است." });
    }
    const updated = await ServiceRequest.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ error: "درخواست پیدا نشد." });
    res.json({ ok: true, status: updated.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// آمار کلی برای داشبورد
app.get("/api/admin/stats", async (req, res) => {
  try {
    const totalCustomers = await Customer.countDocuments();
    const totalRequests  = await ServiceRequest.countDocuments();
    const pendingCount   = await ServiceRequest.countDocuments({ status: "pending" });
    res.json({
      totalCustomers,
      totalRequests,
      pendingCount,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------- Admin: Customers ---------------------- */
// لیست مشتری‌ها
app.get("/api/admin/customers", async (req, res) => {
  try {
    const list = await Customer.find().sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// تنظیم درصد تخفیف مشتری
app.patch("/api/admin/customers/:id/discount", async (req, res) => {
  try {
    const { id } = req.params;
    const discountPercent = Math.max(0, Math.min(100, Number(req.body.discountPercent || 0)));
    const updated = await Customer.findByIdAndUpdate(
      id,
      { $set: { discountPercent } },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: "مشتری پیدا نشد" });
    res.json({ ok: true, discountPercent: updated.discountPercent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
