// utils/jalali.js
const jalaali = require('jalaali-js');

// آخرین رقم سال جلالی و ماه دو رقمی را بده
function getJalaliYearDigitAndMonth(date = new Date()) {
  const { jy, jm } = jalaali.toJalaali(date);
  const yearDigit = String(jy).slice(-1);          // مثلا 1404 → "4"
  const month = jm < 10 ? `0${jm}` : String(jm);   // 5 → "05"
  return { yearDigit, month };
}

// تاریخ میلادی به جلالی (yyyy/mm/dd hh:mm)
function formatJalali(date = new Date()) {
  const { jy, jm, jd } = jalaali.toJalaali(date);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${jy}/${String(jm).padStart(2,'0')}/${String(jd).padStart(2,'0')} ${hh}:${mm}`;
}

module.exports = { getJalaliYearDigitAndMonth, formatJalali };
