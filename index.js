// index.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// اتصال به MongoDB
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('❌ MONGODB_URI در .env/Render تنظیم نشده');
  process.exit(1);
}
mongoose.connect(uri).then(() => {
  console.log('✅ MongoDB connected');
}).catch(err => {
  console.error('Mongo error:', err);
  process.exit(1);
});

// روت‌ها
app.get('/', (req, res) => {
  res.send('SamiWater Backend is running ✅');
});

app.use('/api/customers', require('./routes/customers'));
app.use('/api/requests', require('./routes/requests'));

// هندل خطا
app.use((err, req, res, next) => {
  console.error('Unhandled:', err);
  res.status(500).json({ ok:false, message:'Server error' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
