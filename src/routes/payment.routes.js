// =============================================
//  payment.routes.js — Updated with Chapa
// =============================================
const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/auth');
const {
  initiatePayment,
  verifyPayment,
  chapaCallback,
  paymentSuccess,
  getPaymentHistory
} = require('../controllers/payment.controller');

// Protected routes
router.post('/initiate',         verifyToken, initiatePayment);
router.post('/verify',           verifyToken, verifyPayment);
router.get('/history',           verifyToken, getPaymentHistory);

// Public routes — called by Chapa or redirect
router.post('/chapa-callback',   chapaCallback);
router.get('/success',           paymentSuccess);

module.exports = router;