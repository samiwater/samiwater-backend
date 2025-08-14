import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();

/* ----------------------- Config ----------------------- */
// اگر در محیط ست نکنی، دیفالت‌ها کار می‌کنند:
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const ADMIN_PHONE = (process.env.ADMIN_PHONE || "09384129843").replace(/\D/g, ""); // شماره ادمین (شما)
const ADMIN_STATIC_PIN = (process.env.ADMIN_STATIC_PIN || "2468").trim(); // پین ۴ رقمی ادمین

/* ----------------------- Middlewares ----------------------- */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public")); // پنل ساده از اینجا سرو می‌شود

/* --------------------- MongoDB connect --------------------- */
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) console.error("❌ MONGODB_URI is missing. Put it in .env or Render env vars.");
mongoose
  .connect(MONGODB_URI, {
    dbName: "samiwater",
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    retryWrites: true
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((e) => console.error("❌ MongoDB error:", e.message));

/* ------------------------- Models -------------------------- */
// مشتری
const customerSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    address: { type: String, required: true, trim: true },
    altPhone: { type: String, trim: true },

    // تاریخ تولد شمسی (سه‌بخشی) برای کمپین‌ها
    birthJY: { type: Number, min: 1300, max: 1500 },
    birthJM: { type: Number, min: 1, max: 12 },
    birthJD: { type: Number, min: 1, max: 31 },

    joinedAt: { type: Date, default: () => new Date() },
    city: { type: String, default: "اصفهان", trim: true }
  },
  { timestamps: true }
);
customerSchema.index({ phone: 1 }, { unique: true });
customerSchema.index({ birthJM: 1, birthJD: 1 }); // برای جستجوهای تولد
const Customer = mongoose.model("Customer", customerSchema);

// درخواست خدمت
const requestSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    sourcePath: { type: String, default: "web_form", trim: true }, // مسیر ثبت (urgent/install/repair/...)
    issueType: { type: String, required: true, trim: true }, // عنوان خدمت (با مسیر یکی گرفتیم)
    invoiceCode: { type: String, required: true, unique: true },

    // وضعیت
    status: {
      type: String,
      enum: ["open", "in_progress", "completed", "cancelled"],
      default: "open",
      index: true
    },

    // فالوآپ (مرتبط با فاکتور قبلی)
    isFollowUp: { type: Boolean, default: false },
    relatedToInvoice: { type: String, default: null },

    createdAt: { type: Date, default: () => new Date() }
  },
  { timestamps: true }
);
requestSchema.index({ phone: 1, status: 1 });
requestSchema.index({ invoiceCode: 1 }, { unique: true });
const ServiceRequest = mongoose.model("ServiceRequest", requestSchema);

// OTP (کد ورود یکبارمصرف)
const otpSchema = new mongoose.Schema({
  phone: { type: String, index: true },
  code: String,
  purpose: { type: String, default: "login" }, // login | admin
  createdAt: { type: Date, default: Date.now, expires: 300 } // 5 دقیقه اعتبار
});
const Otp = mongoose.model("Otp", otpSchema);

/* ------------------------ Helpers ------------------------- */
function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}
// کد فاکتور: [آخرین رقم سال جلالی][ماه 2 رقمی][سری ماه]
async function generateInvoiceCode() {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US-u-ca-persian", {
      year: "numeric",
      month: "2-digit",
      timeZone: "Asia/Tehran"
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const lastDigitOfYear = parts.year.slice(-1); // مثل "4" برای 1404
  const month2 = parts.month; // "05"
  const prefix = `${lastDigitOfYear}${month2}`; // "405"

  const latest = await ServiceRequest.findOne({ invoiceCode: new RegExp(`^${prefix}`) })
    .sort({ invoiceCode: -1 })
    .lean();

  let seq = 1;
  if (latest) {
    const prevSeq = parseInt(latest.invoiceCode.slice(prefix.length), 10);
    if (!isNaN(prevSeq)) seq = prevSeq + 1;
  }
  return `${prefix}${String(seq).padStart(2, "0")}`; // مثل 40501
}

/* ------------------------ Auth MWs ------------------------- */
function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "NO_TOKEN" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { phone, role }
    next();
  } catch (e) {
    res.status(401).json({ error: "INVALID_TOKEN" });
  }
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "NO_USER" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "FORBIDDEN" });
  next();
}
function requireAuthOptional(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {}
  }
  next();
}

/* ------------------------- Routes ------------------------- */
// Root & health
app.get("/", (req, res) => res.send("SamiWater Backend is running ✅"));
app.get("/api/health", (req, res) => res.json({ ok: true, status: "SamiWater API is healthy" }));

// Quick API map
app.get("/api", (req, res) => {
  res.json({
    message: "SamiWater API",
    routes: {
      "auth_request_otp": "POST /api/auth/request-otp { phone, pin? }",
      "auth_verify_otp": "POST /api/auth/verify-otp { phone, code } -> token, role",
      "me": "GET /api/me (auth)",
      "admin_ping": "GET /api/admin/ping (admin)",

      "customers_create": "POST /api/customers",
      "customers_list": "GET /api/customers (admin)",
      "customer_by_phone": "GET /api/customers/phone/:phone (owner/admin)",

      "requests_create": "POST /api/requests",
      "requests_active_by_phone": "GET /api/requests/active/:phone",
      "requests_list": "GET /api/requests (admin)",
      "requests_update_status": "PATCH /api/requests/:invoiceCode/status (admin)"
    }
  });
});

/* ----------------------- Auth (PIN + OTP) ------------------------ */
// درخواست کد (ادمین: اول باید PIN درست بده)
app.post("/api/auth/request-otp", async (req, res) => {
  const phone = onlyDigits(req.body.phone);
  const pin = (req.body.pin || "").trim();

  if (!/^09\d{9}$/.test(phone)) return res.status(400).json({ error: "INVALID_PHONE" });

  // برای شماره ادمین، پین ثابت اجباری است
  if (phone === ADMIN_PHONE) {
    if (!pin || pin !== ADMIN_STATIC_PIN) {
      return res.status(401).json({ error: "INVALID_ADMIN_PIN" });
    }
  }

  const code = "" + Math.floor(100000 + Math.random() * 900000);
  await Otp.create({ phone, code, purpose: phone === ADMIN_PHONE ? "admin" : "login" });

  // TODO: در آینده ارسال با سرویس پیامک (فراز)
  console.log("🔐 OTP for", phone, ":", code);

  const devShow = phone === ADMIN_PHONE ? { dev_code: code } : {};
  res.json({ ok: true, message: "کد ارسال شد.", ...devShow });
});

// تایید کد و صدور توکن
app.post("/api/auth/verify-otp", async (req, res) => {
  const phone = onlyDigits(req.body.phone);
  const code = String(req.body.code || "").trim();
  if (!/^09\d{9}$/.test(phone) || !/^\d{4,6}$/.test(code)) {
    return res.status(400).json({ error: "INVALID_INPUT" });
  }

  const found = await Otp.findOne({ phone, code }).sort({ createdAt: -1 }).lean();
  if (!found) return res.status(401).json({ error: "INVALID_CODE" });

  const role = phone === ADMIN_PHONE ? "admin" : "user";
  const token = signToken({ phone, role });
  res.json({ ok: true, token, role });
});

// اطلاعات من
app.get("/api/me", requireAuth, (req, res) => {
  res.json({ ok: true, phone: req.user.phone, role: req.user.role });
});

// تست ادمین
app.get("/api/admin/ping", requireAuth, requireAdmin, (req, res) => {
  res.json({ ok: true, msg: "admin ok" });
});

/* ------------------------ Customers ------------------------ */
// ساخت مشتری (عمومی؛ از فرم وب)
app.post("/api/customers", async (req, res) => {
  try {
    let { fullName, phone, address, altPhone, city, birthJY, birthJM, birthJD } = req.body;
    if (!fullName || !phone || !address)
      return res.status(400).json({ error: "fullName, phone, address الزامی است." });

    phone = onlyDigits(phone);
    const exists = await Customer.findOne({ phone });
    if (exists) return res.status(409).json({ error: "این شماره قبلاً ثبت شده است." });

    const toNum = (v) => (v === "" || v === undefined || v === null ? undefined : Number(v));
    const customer = await Customer.create({
      fullName,
      phone,
      address,
      altPhone,
      city,
      birthJY: toNum(birthJY),
      birthJM: toNum(birthJM),
      birthJD: toNum(birthJD)
    });
    res.status(201).json(customer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// لیست مشتری‌ها (ادمین)
app.get("/api/customers", requireAuth, requireAdmin, async (req, res) => {
  const list = await Customer.find().sort({ createdAt: -1 }).lean();
  res.json(list);
});

// دریافت مشتری با شماره (مالکِ همان شماره یا ادمین)
app.get("/api/customers/phone/:phone", requireAuthOptional, async (req, res) => {
  const phone = onlyDigits(req.params.phone);
  const c = await Customer.findOne({ phone }).lean();
  if (!c) return res.status(404).json({ error: "مشتری پیدا نشد." });

  if (!req.user || req.user.role === "user") {
    if (req.user?.phone !== phone && req.user?.role !== "admin") {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
  }
  res.json(c);
});

/* ------------------------- Requests ------------------------ */
// درخواست فعال برای یک شماره (برای نمایش پیام به کاربر)
app.get("/api/requests/active/:phone", async (req, res) => {
  const phone = onlyDigits(req.params.phone);
  const active = await ServiceRequest.findOne({
    phone,
    status: { $in: ["open", "in_progress"] }
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!active) return res.json({ ok: true, active: null });
  res.json({
    ok: true,
    active: {
      invoiceCode: active.invoiceCode,
      status: active.status,
      createdAt: active.createdAt,
      sourcePath: active.sourcePath,
      issueType: active.issueType
    }
  });
});

// ثبت درخواست جدید
// قانون: تا وقتی درخواست فعال داری، «معمولی» ممنوع؛ مگر اینکه فالوآپ باشد.
app.post("/api/requests", async (req, res) => {
  try {
    const { phone: rawPhone, issueType, sourcePath, isFollowUp, relatedToInvoice } = req.body;
    if (!rawPhone || !issueType)
      return res.status(400).json({ error: "phone و issueType الزامی است." });

    const phone = onlyDigits(rawPhone);
    const customer = await Customer.findOne({ phone });
    if (!customer) return res.status(404).json({ error: "ابتدا مشتری با این شماره ثبت شود." });

    if (!isFollowUp) {
      const active = await ServiceRequest.findOne({
        phone,
        status: { $in: ["open", "in_progress"] }
      })
        .sort({ createdAt: -1 })
        .lean();

      if (active) {
        return res.status(409).json({
          error: "active_request_exists",
          message:
            "یک درخواست درحال انجام/تکمیل‌نشده دارید. لطفاً تا تعیین وضعیت صبر کنید یا با پشتیبانی تماس بگیرید.",
          invoiceCode: active.invoiceCode,
          status: active.status
        });
      }
    }

    // اگر فالوآپ است، اعتبار کد قبلی را چک کنیم
    let rel = null;
    if (isFollowUp && relatedToInvoice) {
      const r = await ServiceRequest.findOne({ invoiceCode: relatedToInvoice }).lean();
      if (!r) return res.status(400).json({ error: "related_invoice_not_found" });
      rel = r.invoiceCode;
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
      relatedToInvoice: rel,
      status: "open"
    });

    res.status(201).json(reqDoc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// تغییر وضعیت درخواست (ادمین
