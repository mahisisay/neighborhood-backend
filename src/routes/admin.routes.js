// =============================================
//  admin.routes.js
// =============================================
const express = require('express');
const router  = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const {
  getPendingProviders,
  verifyProvider,
  suspendUser,
  reactivateUser,
  getDashboardStats,
  getAllUsers
} = require('../controllers/admin.controller');

// All admin routes require login + admin role
router.use(verifyToken, requireRole('admin'));

router.get('/stats',                    getDashboardStats);
router.get('/users',                    getAllUsers);
router.get('/providers/pending',        getPendingProviders);
router.patch('/providers/:id/verify',   verifyProvider);
router.patch('/users/:id/suspend',      suspendUser);
router.patch('/users/:id/reactivate',   reactivateUser);

module.exports = router;