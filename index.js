// index.js

require('dotenv').config(); // بارگذاری .env
const express = require('express');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// برای پشتیبانی از json تو درخواست‌ها
app.use(express.json());

// اتصال به دیتابیس
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
  process.exit(1);
});

// روت آزمایشی برای تست
app.get('/', (req, res) => {
  res.send('SamiWater Backend is running ✅');
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
