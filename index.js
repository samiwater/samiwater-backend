// index.js
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

import requestsRouter from "./routes/requests.js";
import smsTestRouter from "./smsTest.js"; // اگه داری نگه‌دار
import authRouter from "./routes/auth.js"; // ← اضافه شد

dotenv.config();
const app = express();

app.use(cors({ origin: "*", methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"] }));
app.use(express.json({ limit: "1mb" }));

// اتصال DB اگر لازم داری؛ اگر بدون DB هم میخوای بالا بیاد، نبودش رو خطا نده
const MONGODB_URI = process.env.MONGODB_URI || "";
if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI, { dbName: "samiwater", serverSelectionTimeoutMS: 10000 })
    .then(() => console.log("✅ MongoDB connected"))
    .catch((err) => console.error("❌ MongoDB error:", err.message));
} else {
  console.log("⚠️ MONGODB_URI not set (server will run without DB)");
}

app.get("/", (_req, res) => res.send("SamiWater backend is running"));

app.use("/requests", requestsRouter);
app.use("/auth", authRouter);      // ← OTP
app.use("/", smsTestRouter);       // ← اگر داری برای تست

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on :${PORT}`));
