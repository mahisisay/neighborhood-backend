// =============================================
//  review.routes.js
// =============================================
const express = require('express');
const router  = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { submitReview, getProviderReviews } = require('../controllers/review.controller');

router.post('/',                verifyToken, requireRole('seeker'), submitReview);
router.get('/provider/:id',     getProviderReviews);

module.exports = router;