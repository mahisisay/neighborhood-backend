// =============================================
//  server.js — Final Version (Phase 4)
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

// 404
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});