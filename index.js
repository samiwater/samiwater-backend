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
    birthdate:{ type: Date },
    joinedAt:{ type: Date, default: () => new Date() },
    city:    { type: String, default: "اصفهان", trim: true },
    // درصد تخفیف
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
    sourcePath: { type: String, default: "web_form", trim: true },
    issueType:  { type: String, required: true, trim: true },
    invoiceCode:{ type: String, required: true, unique: true },
    status:     { type: String, enum: ["pending","assigned","done","canceled"], default: "pending" },
    createdAt:  { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);
const ServiceRequest = mongoose.model("ServiceRequest", requestSchema);

/* ------------------------ Helpers ------------------------- */
// تولید کُد فاکتور جلالی: [آخرین رقم سال][ماه دو رقمی][سری]
async function generateInvoiceCode() {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US-u-ca-persian", {
      year: "numeric", month: "2-digit", timeZone: "Asia/Tehran",
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  const prefix = `${parts.year.slice(-1)}${parts.month}`; // مثل 405
  const latest = await ServiceRequest.findOne({ invoiceCode: new RegExp(`^${prefix}`) })
    .sort({ invoiceCode: -1 }).lean();
  let seq = 1;
  if (latest) {
    const prev = parseInt(latest.invoiceCode.slice(prefix.length), 10);
    if (!isNaN(prev)) seq = prev + 1;
  }
  return `${prefix}${String(seq).padStart(2,"0")}`; // 40501
}

/* ------------------------- Routes: base ------------------------- */
app.get("/", (_req, res) => res.send("SamiWater Backend is running ✅"));
app.get("/api/health", (_req, res) => res.json({ ok: true, status: "SamiWater API is healthy" }));

const dbTestHandler = async (_req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ ok: true, message: "Database connected successfully!" });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Database connection failed", details: String(e) });
  }
};
app.get("/test", dbTestHandler);
app.get("/api/test", dbTestHandler);

app.get("/api", (_req, res) => {
  res.json({
    message: "SamiWater API",
    routes: {
      // auth
      auth_start: "POST /api/auth/start",
      auth_verify: "POST /api/auth/verify",
      // public
      customers_list: "GET /api/customers",
      customers_create: "POST /api/customers",
      customer_by_phone: "GET /api/customers/phone/:phone",
      requests_list: "GET /api/requests",
      requests_create: "POST /api/requests",
      // admin
      admin_requests_list: "GET /api/admin/requests",
      admin_requests_status: "PATCH /api/admin/requests/:id/status",
      admin_customers_list: "GET /api/admin/customers",
      admin_customer_discount: "PATCH /api/admin/customers/:id/discount",
      admin_stats: "GET /api/admin/stats",
    },
  });
});

/* ------------------------- AUTH (2-step) ------------------------- */
/**
 * مرحله ۱: شروع احراز هویت
 * بدنه: { phone: string, pin?: string }
 * - اگر phone == ADMIN_PHONE و pin == ADMIN_PIN => role=admin
 * - غیر از این => role=user
 * برای تست: کد تایید را همان TEST_OTP برمی‌گردانیم (ارسال پیامک واقعی فعلاً نداریم)
 */
const ADMIN_PHONE = (process.env.ADMIN_PHONE || "").trim();
const ADMIN_PIN   = (process.env.ADMIN_PIN || "").trim();
const TEST_OTP    = (process.env.TEST_OTP || "111111").trim();

app.post("/api/auth/start", async (req, res) => {
  try {
    const { phone, pin } = req.body || {};
    if (!phone) return res.status(400).json({ ok: false, error: "phone الزامی است" });

    // نقش پیش‌فرض
    let role = "user";

    // چک ادمین
    if (ADMIN_PHONE && phone === ADMIN_PHONE) {
      if (!ADMIN_PIN || pin === ADMIN_PIN) {
        role = "admin";
      } else {
        return res.status(401).json({ ok: false, error: "PIN نادرست است" });
      }
    }

    // وجود مشتری برای user (اختیاری — می‌تونی مجبورش کنی عضو باشد)
    const exists = await Customer.findOne({ phone }).lean();
    if (!exists && role === "user") {
      // می‌تونیم اجازه بدیم ادامه بده و در verify بسازیم؛ فعلاً اجازه می‌دهیم.
    }

    return res.json({
      ok: true,
      role,
      next: "verify",
      // برای تست نمایش می‌دهیم؛ در نسخه نهایی این فیلد را حذف کن و پیامک واقعی بفرست.
      devCode: TEST_OTP,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * مرحله ۲: تأیید کد
 * بدنه: { phone: string, code: string }
 * اگر code == TEST_OTP قبول می‌کنیم و یک توکن ساده برمی‌گردانیم.
 */
app.post("/api/auth/verify", async (req, res) => {
  try {
    const { phone, code } = req.body || {};
    if (!phone || !code) return res.status(400).json({ ok: false, error: "phone و code الزامی است" });

    if (code !== TEST_OTP) {
      return res.status(401).json({ ok: false, error: "کد تایید نادرست است" });
    }

    let role = "user";
    if (ADMIN_PHONE && phone === ADMIN_PHONE) role = "admin";

    // توکن ساده (فعلاً بدون JWT)
    const token = `${role}-${phone}-${Date.now()}`;

    return res.json({ ok: true, role, token });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------------------- Public: Customers ---------------------- */
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

    const customer = await Customer.create({ fullName, phone, address, altPhone, birthdate, city });
    res.status(201).json(customer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/customers", async (_req, res) => {
  const list = await Customer.find().sort({ createdAt: -1 }).lean();
  res.json(list);
});

app.get("/api/customers/phone/:phone", async (req, res) => {
  const c = await Customer.findOne({ phone: req.params.phone }).lean();
  if (!c) return res.status(404).json({ error: "مشتری پیدا نشد." });
  res.json(c);
});

/* ---------------------- Public: Requests ---------------------- */
app.post("/api/requests", async (req, res) => {
  try {
    const { phone, issueType, sourcePath } = req.body;
    if (!phone || !issueType) {
      return res.status(400).json({ error: "phone و issueType الزامی است." });
    }
    const customer = await Customer.findOne({ phone });
    if (!customer) return res.status(404).json({ error: "ابتدا مشتری با این شماره ثبت شود." });

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

app.get("/api/requests", async (_req, res) => {
  const list = await ServiceRequest.find().sort({ createdAt: -1 }).lean();
  res.json(list);
});

/* ---------------------- Admin: Requests ---------------------- */
app.get("/api/admin/requests", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const list = await ServiceRequest.find().sort({ createdAt: -1 }).limit(limit).lean();
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/admin/requests/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!["pending","assigned","done","canceled"].includes(status)) {
      return res.status(400).json({ error: "وضعیت نامعتبر است." });
    }
    const updated = await ServiceRequest.findByIdAndUpdate(id, { $set: { status } }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: "درخواست پیدا نشد." });
    res.json({ ok: true, status: updated.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/stats", async (_req, res) => {
  try {
    const totalCustomers = await Customer.countDocuments();
    const totalRequests  = await ServiceRequest.countDocuments();
    const pendingCount   = await ServiceRequest.countDocuments({ status: "pending" });
    res.json({ totalCustomers, totalRequests, pendingCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------------------- Admin: Customers ---------------------- */
app.get("/api/admin/customers", async (_req, res) => {
  try {
    const list = await Customer.find().sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/admin/customers/:id/discount", async (req, res) => {
  try {
    const { id } = req.params;
    const discountPercent = Math.max(0, Math.min(100, Number(req.body.discountPercent || 0)));
    const updated = await Customer.findByIdAndUpdate(id, { $set: { discountPercent } }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: "مشتری پیدا نشد" });
    res.json({ ok: true, discountPercent: updated.discountPercent });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* -------------------- 404 & Error handlers -------------------- */
app.use((req, res) => res.status(404).json({ error: "Route not found", path: req.originalUrl }));
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

/* ---------------------- Start server ---------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server listening on", PORT));
