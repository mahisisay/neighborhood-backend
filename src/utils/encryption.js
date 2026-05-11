// =============================================
//  encryption.js — AES-256 Phone Encryption
//  We encrypt phone numbers before saving to
//  the database so even if someone steals the
//  database, they can't read phone numbers.
// =============================================

const crypto = require('crypto'); // built into Node.js, no install needed
require('dotenv').config();

const KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'utf8'); // 32 bytes
const IV  = Buffer.from(process.env.ENCRYPTION_IV,  'utf8'); // 16 bytes

// encrypt: plain text phone → encrypted hex string
// Example: "0911234567" → "a3f8c2d1..."
function encrypt(text) {
  const cipher = crypto.createCipheriv('aes-256-cbc', KEY, IV);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

// decrypt: encrypted hex string → plain text phone
// Example: "a3f8c2d1..." → "0911234567"
function decrypt(encryptedHex) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, IV);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };