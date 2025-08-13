// models/Counter.js
const mongoose = require('mongoose');

const CounterSchema = new mongoose.Schema(
  {
    ymKey: { type: String, required: true, unique: true }, // مثلا "405" (سال=4، ماه=05)
    seq: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Counter', CounterSchema);
