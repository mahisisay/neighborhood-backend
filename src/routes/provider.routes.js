// =============================================
//  provider.routes.js — Provider Endpoints
// =============================================

const express = require('express');
const router  = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { toggleStatus, getNearbyProviders } = require('../controllers/provider.controller');

// Anyone can browse nearby providers
router.get('/nearby', getNearbyProviders);

// Provider only
router.patch('/toggle-status', verifyToken, requireRole('provider'), toggleStatus);

module.exports = router;