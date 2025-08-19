import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

import smsTestRouter from "./smsTest.js"; // ← مسیر تست پیامک

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
const MONGODB_URI = process.env.MONGODB_URI || "";
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is missing. Put it in env vars.");
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

/* --------------------- Health & Root ---------------------- */
app.get("/", (req, res) => {
  res.send("SamiWater Backend is running ✅");
});
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

/* ---------------------- Mount Routes ---------------------- */
app.use("/api", smsTestRouter); // ← نتیجه: /api/test-sms

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
