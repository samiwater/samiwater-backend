import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

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

/* --------------------- ENV & Consts --------------------- */
const {
  MONGODB_URI,
  ADMIN_PHONE = "09384129843",          // شماره ادمین
  ADMIN_PIN = "1234",                    // پین ثابت 4رقمی ادمین
  JWT_SECRET = "samiwater-secret",       // حتماً در Render یک مقدار قوی بگذار
  OTP_TTL_MIN = "5",                     // اعتبار OTP به دقیقه
  SEND_SMS = "false",                    // بعداً true و اتصال به پنل
} = process.env;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is missing. Put it in .env or Render env vars.");
}

/* --------------------- MongoDB connect --------------------- */
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
    customer:    { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    phone:       { type: String, required: true, trim: true },
    address:     { type: String, required: true, trim: true },
    sourcePath:  { type: String, default: "web_form", trim: true },
    issueType:   { type: String, required: true, trim: true },
    invoiceCode: { type: String, required: true, unique: true },
    createdAt:   { type: Date, default: () => new Date() },
    status:      { type: String, default: "open", enum: ["open","in_progress","done","cancelled"] }
  },
  { timestamps: true }
);
const ServiceRequest = mongoose.model("ServiceRequest", requestSchema);

// OTP
const otpSchema = new mongoose.Schema(
  {
    phone:   { type: String, index: true },
    code:    { type: String },
    purpose: { type: String, default: "login" },
    expireAt:{ type: Date, index: { expires: 0 } } // TTL index خودکار
  },
  { timestamps: true }
);
const Otp = mongoose.model("Otp", otpSchema);

/* ------------------------ Helpers ------------------------- */
// Invoice code (Jalali-like)
async function generateInvoiceCode() {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US-u-ca-persian", { year: "numeric", month: "2-digit", timeZone: "Asia/Tehran" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const prefix = `${parts.year.slice(-1)}${parts.month}`; // e.g. "405"
  const latest = await ServiceRequest.findOne({ invoiceCode: new RegExp(`^${prefix}`) })
    .sort({ invoiceCode: -1 })
    .lean();
  let seq = 1;
  if (latest) {
    const prevSeq = parseInt(latest.invoiceCode.slice(prefix.length), 10);
    if (!isNaN(prevSeq)) seq = prevSeq + 1;
  }
  return `${prefix}${String(seq).padStart(2, "0")}`; // 40501
}

function normalizePhone(v = "") {
  return String(v).replace(/\D/g, "");
}

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function authRequired(req, res, next) {
  try {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "NO_TOKEN" });
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "BAD_TOKEN" });
  }
}

/* Stub SMS sender: swap with your SMS panel later */
async function sendOtpSMS(phone, code) {
  if (SEND_SMS === "true") {
    // TODO: connect to SMS provider here
  }
  console.log(`📲 OTP for ${phone}: ${code}`); // فعلاً در لاگ
}

/* ------------------------- Routes ------------------------- */
app.get("/", (req, res) => res.send("SamiWater Backend is running ✅"));
app.get("/api/health", (req, res) => res.json({ ok: true, status: "SamiWater API is healthy" }));

// DB test
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

// API map
app.get("/api", (req, res) => {
  res.json({
    message: "SamiWater API",
    routes: {
      health: "GET /api/health",
      test: "GET /api/test",
      auth_role_check: "GET /api/auth/role/:phone",
      auth_request_otp: "POST /api/auth/request-otp",
      auth_verify_otp: "POST /api/auth/verify-otp",
      me: "GET /api/me (Bearer token)",
      customers_list: "GET /api/customers",
      customers_create: "POST /api/customers",
      customer_by_phone: "GET /api/customers/phone/:phone",
      requests_list: "GET /api/requests",
      requests_create: "POST /api/requests",
    },
  });
});

// ---- Auth: role by phone
app.get("/api/auth/role/:phone", (req, res) => {
  const phone = normalizePhone(req.params.phone);
  if (!/^09\d{9}$/.test(phone)) {
    return res.status(400).json({ ok: false, error: "INVALID_PHONE" });
  }
  const role = phone === normalizePhone(ADMIN_PHONE) ? "admin" : "user";
  res.json({ ok: true, role });
});

// ---- Auth: request OTP
app.post("/api/auth/request-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!/^09\d{9}$/.test(phone)) return res.status(400).json({ ok: false, error: "INVALID_PHONE" });

    // برای کاربر عادی: باید مشتری وجود داشته باشد
    const role = phone === normalizePhone(ADMIN_PHONE) ? "admin" : "user";
    if (role === "user") {
      const exists = await Customer.findOne({ phone }).lean();
      if (!exists) return res.status(404).json({ ok: false, error: "CUSTOMER_NOT_FOUND" });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
    const ttlMin = parseInt(OTP_TTL_MIN, 10) || 5;
    const expireAt = new Date(Date.now() + ttlMin * 60 * 1000);

    await Otp.deleteMany({ phone }); // invalidate previous
    await Otp.create({ phone, code, purpose: "login", expireAt });

    await sendOtpSMS(phone, code);
    res.json({ ok: true, sent: true, ttlMin });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- Auth: verify OTP (admin needs pin)
app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const code = String(req.body.code || "");
    const pin  = String(req.body.pin || "");
    if (!/^09\d{9}$/.test(phone)) return res.status(400).json({ ok: false, error: "INVALID_PHONE" });

    const role = phone === normalizePhone(ADMIN_PHONE) ? "admin" : "user";
    if (role === "admin" && pin !== ADMIN_PIN) {
      return res.status(403).json({ ok: false, error: "BAD_PIN" });
    }

    const otp = await Otp.findOne({ phone, code }).lean();
    if (!otp) return res.status(400).json({ ok: false, error: "OTP_INVALID" });
    if (otp.expireAt && otp.expireAt < new Date()) return res.status(400).json({ ok: false, error: "OTP_EXPIRED" });

    await Otp.deleteMany({ phone }); // one-time

    const token = createToken({ phone, role });
    res.json({ ok: true, token, role });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- Me: profile + recent requests (protected)
app.get("/api/me", authRequired, async (req, res) => {
  try {
    const phone = req.user.phone;
    const profile = req.user.role === "admin"
      ? { role: "admin", phone }
      : await Customer.findOne({ phone }).lean();

    const orders = await ServiceRequest.find({ phone })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.json({ ok: true, profile, requests: orders, role: req.user.role });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Customers
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

app.get("/api/customers", async (req, res) => {
  const list = await Customer.find().sort({ createdAt: -1 }).lean();
  res.json(list);
});

app.get("/api/customers/phone/:phone", async (req, res) => {
  const c = await Customer.findOne({ phone: normalizePhone(req.params.phone) }).lean();
  if (!c) return res.status(404).json({ error: "مشتری پیدا نشد." });
  res.json(c);
});

// --- Requests
app.post("/api/requests", async (req, res) => {
  try {
    const { phone, issueType, sourcePath } = req.body;
    if (!phone || !issueType) {
      return res.status(400).json({ error: "phone و issueType الزامی است." });
    }
    const customer = await Customer.findOne({ phone: normalizePhone(phone) });
    if (!customer) return res.status(404).json({ error: "ابتدا مشتری با این شماره ثبت شود." });

    // ضداسپم/وضعیت: اگر درخواست باز دارد، ثبت نکن
    const openOne = await ServiceRequest.findOne({ phone: customer.phone, status: { $in: ["open","in_progress"] } }).lean();
    if (openOne) {
      return res.status(429).json({ error: "یک درخواست باز دارید؛ پس از نهایی‌شدن می‌توانید دوباره ثبت کنید.", openInvoiceCode: openOne.invoiceCode });
    }

    const invoiceCode = await generateInvoiceCode();
    const reqDoc = await ServiceRequest.create({
      customer: customer._id,
      phone: customer.phone,
      address: customer.address,
      sourcePath: sourcePath || "web_form",
      issueType,
      invoiceCode,
      status: "open"
    });

    res.status(201).json(reqDoc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/requests", async (req, res) => {
  const q = {};
  if (req.query.phone) q.phone = normalizePhone(req.query.phone);
  const list = await ServiceRequest.find(q).sort({ createdAt: -1 }).lean();
  res.json(list);
});

/* -------------------- 404 & Error handlers -------------------- */
app.use((req, res) => res.status(404).json({ error: "Route not found", path: req.originalUrl }));
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

/* ---------------------- Start server ---------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server listening on", PORT));
