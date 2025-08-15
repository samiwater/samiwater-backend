import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import smsTestRoute from "./smsTest.js"; // ⬅️ برای تست پیامک

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

/* ⬅️ فعال‌سازی روت تست SMS */
app.use(smsTestRoute);

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
    fullName: { type: String, required: true, trim: true },
    phone:   { type: String, required: true, unique: true, trim: true },
    address: { type: String, required: true, trim: true },
    altPhone:{ type: String, trim: true },
    birthdate:{ type: Date },
    joinedAt:{ type: Date, default: () => new Date() },
    city:    { type: String, default: "اصفهان", trim: true },
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
    sourcePath: { type: String, default: "web_form", trim: true }, // مسیر ثبت
    issueType:  { type: String, required: true, trim: true },      // نوع مشکل/خدمت
    invoiceCode:{ type: String, required: true, unique: true },    // کُد فاکتور یکتا
    createdAt:  { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);
const ServiceRequest = mongoose.model("ServiceRequest", requestSchema);

/* ------------------------ Helpers ------------------------- */
// تولید کُد فاکتور جلالی: [آخر رقم سال][ماه دو رقمی][سری ماه]
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
  const month2 = parts.month; // "05" یا "06"
  const prefix = `${lastDigitOfYear}${month2}`; // "405" یا "406"

  // آخرین کد همین ماه
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
  return `${prefix}${seqStr}`; // مثل 40501 یا 40601
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
    },
  });
});

// --- Customers ---
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

// --- Requests ---
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
