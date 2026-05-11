// =============================================
//  payment.routes.js
// =============================================
const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/auth');
const { initiatePayment, verifyPayment, getPaymentHistory } = require('../controllers/payment.controller');

router.post('/initiate', verifyToken, initiatePayment);
router.post('/verify',   verifyToken, verifyPayment);
router.get('/history',   verifyToken, getPaymentHistory);

module.exports = router;