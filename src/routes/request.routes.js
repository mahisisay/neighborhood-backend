// =============================================
//  request.routes.js — Service Request Endpoints
// =============================================

const express = require('express');
const router  = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const {
  createRequest,
  getMyRequests,
  getOfferedJobs,
  acceptJob,
  rejectJob,
  getCategories
} = require('../controllers/request.controller');

// Public — no login needed
router.get('/categories', getCategories);

// Seeker routes
router.post('/',     verifyToken, requireRole('seeker'),   createRequest);
router.get('/my',    verifyToken, requireRole('seeker'),   getMyRequests);

// Provider routes
router.get('/offered',       verifyToken, requireRole('provider'), getOfferedJobs);
router.post('/:id/accept',   verifyToken, requireRole('provider'), acceptJob);
router.post('/:id/reject',   verifyToken, requireRole('provider'), rejectJob);

module.exports = router;