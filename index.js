import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

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
const customerSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    address: { type: String, required: true, trim: true },
    altPhone: { type: String, trim: true },
    // تاریخ تولد (ترجیحاً با سه فیلد جدا ذخیره کنیم تا تولد شمسی ساده‌تر شود)
    birthDay: { type: Number, min: 1, max: 31 },   // 1..31
    birthMonth: { type: Number, min: 1, max: 12 }, // 1..12
    birthYear: { type: Number },                   // 1330..1399 (طبق نیاز)
    joinedAt: { type: Date, default: () => new Date() },
    city: { type: String, default: "اصفهان", trim: true },
  },
  { timestamps: true }
);
const Customer = mongoose.model("Customer", customerSchema);

const requestSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    sourcePath: { type: String, default: "web_form", trim: true },
    issueType: { type: String, required: true, trim: true },
    invoiceCode: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["pending", "assigned", "done", "canceled"],
      default: "pending",
    },
    prevInvoiceCode: { type: String }, // اگر درخواستِ مرتبط با فاکتور قبلی بود
    createdAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);
const ServiceRequest = mongoose.model("ServiceRequest", requestSchema);

/* ------------------------ Helpers ------------------------- */
// تولید کد فاکتور (جلالی: [آخرِ سال][ماه دو رقمی][سری])
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
  const lastDigitOfYear = parts.year.slice(-1);
  const month2 = parts.month;
  const prefix = `${lastDigitOfYear}${month2}`;

  const latest = await ServiceRequest.findOne({ invoiceCode: new RegExp(`^${prefix}`) })
    .sort({ invoiceCode: -1 })
    .lean();

  let seq = 1;
  if (latest) {
    const prevSeq = parseInt(latest.invoiceCode.slice(prefix.length), 10);
    if (!isNaN(prevSeq)) seq = prevSeq + 1;
  }
  const seqStr = String(seq).padStart(2, "0");
  return `${prefix}${seqStr}`;
}

/* ------------------------- Auth Core ----------------------- */
// ادمین از طریق env
const ADMIN_PHONE = (process.env.ADMIN_PHONE || "09384129843").trim();
const ADMIN_PIN = (process.env.ADMIN_PIN || "2468").trim();
const JWT_SECRET = (process.env.JWT_SECRET || "samiwater_super_secret_key").trim();

// OTP در حافظه (۵ دقیقه اعتبار)
const otpStore = new Map(); // key: phone, value: { code, role, exp }

function genOTP() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
}
function putOTP(phone, role = "user") {
  const code = genOTP();
  const exp = Date.now() + 5 * 60 * 1000;
  otpStore.set(phone, { code, role, exp });
  return code;
}
function takeOTP(phone, code) {
  const row = otpStore.get(phone);
  if (!row) return { ok: false, msg: "کدی یافت نشد" };
  if (Date.now() > row.exp) {
    otpStore.delete(phone);
    return { ok: false, msg: "کُد منقضی شده" };
  }
  if (row.code !== code) return { ok: false, msg: "کُد نادرست است" };
  otpStore.delete(phone);
  return { ok: true, role: row.role };
}

// توکن سبک (HMAC)
function signToken(payload, ttlSec = 3600 * 12) {
  const data = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSec };
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyToken(token) {
  try {
    const [body, sig] = token.split(".");
    const calc = crypto.createHmac("sha256", JWT_SECRET).update(body).digest("base64url");
    if (calc !== sig) return null;
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (data.exp && Date.now() / 1000 > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}
function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "توکن ندارید" });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "توکن نامعتبر است" });
  req.user = payload; // {sub, role, phone, customerId?}
  next();
}
function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "دسترسی ادمین لازم است" });
  next();
}

/* ------------------------- Routes ------------------------- */
// روت‌های ساده
app.get("/", (req, res) => res.send("SamiWater Backend is running ✅"));
app.get("/api/health", (req, res) => res.json({ ok: true, status: "SamiWater API is healthy" }));
const dbTestHandler = async (req, res) => {
  try { await mongoose.connection.db.admin().ping(); res.json({ ok: true, message: "Database connected successfully!" }); }
  catch (e) { res.status(500).json({ ok: false, error: "Database connection failed", details: String(e) }); }
};
app.get("/test", dbTestHandler);
app.get("/api/test", dbTestHandler);

// راهنما
app.get("/api", (req, res) => {
  res.json({
    message: "SamiWater API",
    routes: {
      // Auth
      request_otp: "POST /api/auth/request-otp {phone, pin?}",
      verify_otp: "POST /api/auth/verify {phone, code}",
      me: "GET /api/me (Bearer token)",
      // Admin
      admin_requests: "GET /api/admin/requests",
      admin_customers: "GET /api/admin/customers",
      admin_request_update: "PATCH /api/admin/requests/:id {status}",
      // Business
      customers_list: "GET /api/customers",
      customers_create: "POST /api/customers",
      customer_by_phone: "GET /api/customers/phone/:phone",
      requests_list: "GET /api/requests",
      requests_create: "POST /api/requests",
    },
  });
});

/* --------------------------- Auth -------------------------- */
// درخواست OTP
app.post("/api/auth/request-otp", async (req, res) => {
  try {
    const { phone, pin } = req.body || {};
    if (!phone) return res.status(400).json({ error: "phone لازم است" });

    let role = "user";
    if (phone.trim() === ADMIN_PHONE) {
      if (!pin || String(pin).trim() !== ADMIN_PIN) {
        return res.status(401).json({ error: "PIN ادمین نادرست است" });
      }
      role = "admin";
    } else {
      // کاربر عادی باید در دیتابیس موجود باشد
      const exists = await Customer.findOne({ phone: phone.trim() }).lean();
      if (!exists) {
        return res.status(404).json({ error: "مشتری با این شماره یافت نشد" });
      }
    }

    const code = putOTP(phone.trim(), role);
    // TODO: در آینده: ارسال SMS/Email
    return res.json({ ok: true, devCode: code, note: "در حالت تست، کد داخل پاسخ است." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// تایید OTP و صدور توکن
app.post("/api/auth/verify", async (req, res) => {
  try {
    const { phone, code } = req.body || {};
    if (!phone || !code) return res.status(400).json({ error: "phone و code لازم است" });

    const check = takeOTP(phone.trim(), String(code).trim());
    if (!check.ok) return res.status(401).json({ error: check.msg });

    let payload = { sub: phone.trim(), phone: phone.trim(), role: check.role };
    if (check.role === "user") {
      const c = await Customer.findOne({ phone: phone.trim() }).lean();
      if (!c) return res.status(404).json({ error: "مشتری پیدا نشد" });
      payload.customerId = String(c._id);
    }
    const token = signToken(payload, 60 * 60 * 12); // 12h
    return res.json({ ok: true, token, role: check.role });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// اطلاعات من + سوابق یا داشبورد ادمین (یکجا)
app.get("/api/me", authRequired, async (req, res) => {
  try {
    if (req.user.role === "admin") {
      const totalCustomers = await Customer.countDocuments();
      const totalRequests = await ServiceRequest.countDocuments();
      const pending = await ServiceRequest.countDocuments({ status: "pending" });
      const lastRequests = await ServiceRequest.find().sort({ createdAt: -1 }).limit(20).lean();
      return res.json({
        role: "admin",
        stats: { totalCustomers, totalRequests, pending },
        lastRequests,
      });
    }
    // user
    const customer = await Customer.findById(req.user.customerId).lean();
    const myRequests = await ServiceRequest.find({ phone: req.user.phone }).sort({ createdAt: -1 }).lean();
    return res.json({ role: "user", customer, myRequests });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------ Business ------------------------- */
// ساخت مشتری
app.post("/api/customers", async (req, res) => {
  try {
    let { fullName, phone, address, altPhone, birthDay, birthMonth, birthYear, city } = req.body;
    if (!fullName || !phone || !address) {
      return res.status(400).json({ error: "fullName, phone, address الزامی است." });
    }
    const exists = await Customer.findOne({ phone });
    if (exists) return res.status(409).json({ error: "این شماره قبلاً ثبت شده است." });

    // نرمالایز تولد
    const bD = Number(birthDay) || undefined;
    const bM = Number(birthMonth) || undefined;
    const bY = Number(birthYear) || undefined;

    const customer = await Customer.create({
      fullName,
      phone,
      address,
      altPhone,
      birthDay: bD,
      birthMonth: bM,
      birthYear: bY,
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

// ثبت درخواست خدمت با کنترل وضعیت فاکتور
app.post("/api/requests", async (req, res) => {
  try {
    const { phone, issueType, sourcePath, prevInvoiceCode } = req.body;
    if (!phone || !issueType) {
      return res.status(400).json({ error: "phone و issueType الزامی است." });
    }
    const customer = await Customer.findOne({ phone });
    if (!customer) {
      return res.status(404).json({ error: "ابتدا مشتری با این شماره ثبت شود." });
    }

    // اگر prevInvoiceCode داده شده باشد: اجازه ثبت درخواست مرتبط
    if (!prevInvoiceCode) {
      // در غیر اینصورت: تا وقتی فاکتور باز (done نیست) وجود دارد، اجازه ثبت جدید نده
      const openReq = await ServiceRequest.findOne({ phone, status: { $ne: "done" } }).sort({ createdAt: -1 }).lean();
      if (openReq) {
        return res.status(409).json({
          error: "شما یک درخواست درحال انجام یا تکمیل‌نشده دارید. لطفاً صبر کنید یا با پشتیبانی تماس بگیرید.",
          lastInvoiceCode: openReq.invoiceCode,
          lastStatus: openReq.status,
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
      prevInvoiceCode: prevInvoiceCode || undefined,
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

/* ------------------------- Admin --------------------------- */
app.get("/api/admin/requests", authRequired, adminOnly, async (req, res) => {
  const list = await ServiceRequest.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json(list);
});
app.get("/api/admin/customers", authRequired, adminOnly, async (req, res) => {
  const list = await Customer.find().sort({ createdAt: -1 }).limit(200).lean();
  res.json(list);
});
app.patch("/api/admin/requests/:id", authRequired, adminOnly, async (req, res) => {
  const { status } = req.body || {};
  if (!["pending", "assigned", "done", "canceled"].includes(status || ""))
    return res.status(400).json({ error: "وضعیت نامعتبر است" });
  const updated = await ServiceRequest.findByIdAndUpdate(
    req.params.id,
    { $set: { status } },
    { new: true }
  ).lean();
  res.json(updated);
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
