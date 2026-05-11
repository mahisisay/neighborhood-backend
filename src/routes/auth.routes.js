// =============================================
//  auth.routes.js — Auth API Endpoints
//  This file maps URLs to controller functions.
//  Think of it as a traffic director.
// =============================================

const express    = require('express');
const router     = express.Router();
const { register, login, getMe } = require('../controllers/auth.controller');
const { verifyToken } = require('../middleware/auth');

// POST /api/auth/register — create new account
router.post('/register', register);

// POST /api/auth/login — login and get token
router.post('/login', login);

// GET /api/auth/me — get my profile (must be logged in)
router.get('/me', verifyToken, getMe);

module.exports = router;