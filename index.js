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
// Customer (با تاریخ تولد شمسی ۳ بخشی)
const customerSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    address: { type: String, required: true, trim: true },
    altPhone: { type: String, trim: true },

    // تاریخ تولد شمسی: سه پارامتر جدا برای جست‌وجوهای بعدی
    birthJY: { type: Number, min: 1300, max: 1500 }, // سال شمسی
    birthJM: { type: Number, min: 1, max: 12 },      // ماه شمسی
    birthJD: { type: Number, min: 1, max: 31 },      // روز شمسی

    joinedAt: { type: Date, default: () => new Date() },
    city: { type: String, default: "اصفهان", trim: true },
  },
  { timestamps: true }
);
customerSchema.index({ phone: 1 }, { unique: true });
customerSchema.index({ birthJM: 1, birthJD: 1 }); // برای پیدا کردن تبریک‌های ماه/روز
const Customer = mongoose.model("Customer", customerSchema);

// Service Request
const requestSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    sourcePath: { type: String, default: "web_form", trim: true }, // مسیر ثبت (مثلاً urgent/landing/web_form)
    issueType: { type: String, required: true, trim: true }, // نوع خدمت/مسیر
    invoiceCode: { type: String, required: true, index: true }, // مثل 40501
    createdAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);
requestSchema.index({ phone: 1, sourcePath: 1, createdAt: -1 });
requestSchema.index({ invoiceCode: 1 }, { unique: true });
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
  const lastDigitOfYear = parts.year.slice(-1); // 1404 -> "4"
  const month2 = parts.month;                   // "05"
  const prefix = `${lastDigitOfYear}${month2}`; // "45" -> مثل "45"

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

/* ------------------------- Routes ------------------------- */
// صفحه اصلی
app.get("/", (req, res) => {
  res.send("SamiWater Backend is running ✅");
});

// سلامت
app.get("/api/health", (req, res) => {
  res.json({ ok: true, status: "SamiWater API is healthy" });
});

// راهنمای سریع API
app.get("/api", (req, res) => {
  res.json({
    message: "SamiWater API",
    routes: {
      health: "GET /api/health",
      customers_list: "GET /api/customers",
      customers_create: "POST /api/customers  {fullName, phone, address, altPhone?, city?, birthJY?, birthJM?, birthJD?}",
      customer_by_phone: "GET /api/customers/phone/:phone",
      requests_list: "GET /api/requests",
      requests_create: "POST /api/requests  {phone, issueType, sourcePath?}  // ضداسپم 24ساعته",
    },
  });
});

// --- Customers ---
// ساخت مشتری
app.post("/api/customers", async (req, res) => {
  try {
    let { fullName, phone, address, altPhone, city, birthJY, birthJM, birthJD } = req.body;

    if (!fullName || !phone || !address) {
      return res.status(400).json({ error: "fullName, phone, address الزامی است." });
    }

    // نرمال‌سازی ارقام
    phone = String(phone).replace(/\D/g, "");
    if (!/^09\d{9}$/.test(phone)) {
      return res.status(400).json({ error: "فرمت شماره موبایل صحیح نیست." });
    }

    const exists = await Customer.findOne({ phone });
    if (exists) return res.status(409).json({ error: "این شماره قبلاً ثبت شده است." });

    // پاکسازی مقادیر تولد (عدد معتبر یا undefined)
    const toNum = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));
    birthJY = toNum(birthJY);
    birthJM = toNum(birthJM);
    birthJD = toNum(birthJD);

    const customer = await Customer.create({
      fullName,
      phone,
      address,
      altPhone,
      city,
      birthJY,
      birthJM,
      birthJD,
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
  const phone = String(req.params.phone).replace(/\D/g, "");
  const c = await Customer.findOne({ phone }).lean();
  if (!c) return res.status(404).json({ error: "مشتری پیدا نشد." });
  res.json(c);
});

// --- Requests ---
// ثبت درخواست خدمت (با **ضداسپم ۲۴ساعته** روی phone + sourcePath)
app.post("/api/requests", async (req, res) => {
  try {
    const { phone: rawPhone, issueType, sourcePath } = req.body;
    if (!rawPhone || !issueType) {
      return res.status(400).json({ error: "phone و issueType الزامی است." });
    }

    const phone = String(rawPhone).replace(/\D/g, "");
    const src = (sourcePath || "web_form").toLowerCase();

    const customer = await Customer.findOne({ phone });
    if (!customer) {
      return res.status(404).json({ error: "ابتدا مشتری با این شماره ثبت شود." });
    }

    // ✅ ضداسپم: هر شماره از هر مسیر، یک درخواست در ۲۴ساعت
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dup = await ServiceRequest.findOne({
      phone,
      sourcePath: src,
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (dup) {
      return res
        .status(429)
        .json({ error: "در هر ۲۴ ساعت از این مسیر فقط یک درخواست می‌توانید ثبت کنید." });
    }

    const invoiceCode = await generateInvoiceCode();
    const reqDoc = await ServiceRequest.create({
      customer: customer._id,
      phone: customer.phone,
      address: customer.address,
      sourcePath: src,
      issueType,
      invoiceCode,
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
