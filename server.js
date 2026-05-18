// =============================================
//  server.js — Final Version
// =============================================

const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(cors());

// ── All Routes ────────────────────────────────
app.use('/api/auth',      require('./src/routes/auth.routes'));
app.use('/api/requests',  require('./src/routes/request.routes'));
app.use('/api/providers', require('./src/routes/provider.routes'));
app.use('/api/payments',  require('./src/routes/payment.routes'));
app.use('/api/admin',     require('./src/routes/admin.routes'));
app.use('/api/reviews',   require('./src/routes/review.routes'));
app.use('/api/providers', require('./src/routes/provider.onboard.routes'));

// Health check
app.get('/', (req, res) => {
  res.json({ message: '🏘️ Neighborhood Service Finder API is running!' });
});

// TEMPORARY — update categories once then remove!
app.get('/migrate-categories', async (req, res) => {
  const db = require('./src/config/db');
  try {
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    await db.query('DELETE FROM categories');
    await db.query('ALTER TABLE categories AUTO_INCREMENT = 1');
    await db.query(`INSERT INTO categories (name, icon) VALUES
      ('Home Maintenance & Repair', 'wrench'),
      ('Cleaning & Domestic',       'wind'),
      ('Personal & Lifestyle',      'scissors'),
      ('Tutoring & Skill Training', 'book'),
      ('Delivery & Shopping',       'truck'),
      ('Technical & Digital',       'smartphone')`);
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    res.json({ message: '✅ Categories updated successfully!' });
  } catch(err) {
    res.json({ error: err.message });
  }
});

// 404 — must be last!
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});