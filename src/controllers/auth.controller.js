// =============================================
//  auth.controller.js — UPDATED
//  Pending providers can now get token for uploads
// =============================================

const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../config/db');
const { encrypt, decrypt } = require('../utils/encryption');
require('dotenv').config();

// ─────────────────────────────────────────────
//  REGISTER
//  POST /api/auth/register
// ─────────────────────────────────────────────
async function register(req, res) {
  try {
    const { name, phone, password, role } = req.body;

    if (!name || !phone || !password || !role) {
      return res.status(400).json({ message: 'All fields are required: name, phone, password, role' });
    }

    if (!['seeker', 'provider'].includes(role)) {
      return res.status(400).json({ message: 'Role must be seeker or provider' });
    }

    const encryptedPhone = encrypt(phone);

    const [existing] = await db.query(
      'SELECT id FROM users WHERE phone = ?',
      [Buffer.from(encryptedPhone, 'hex')]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Phone number already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const status = role === 'provider' ? 'pending' : 'active';

    const [result] = await db.query(
      `INSERT INTO users (name, phone, password_hash, role, status) VALUES (?, ?, ?, ?, ?)`,
      [name, Buffer.from(encryptedPhone, 'hex'), passwordHash, role, status]
    );

    const userId = result.insertId;

    if (role === 'provider') {
      await db.query(
        'INSERT INTO provider_profiles (user_id) VALUES (?)',
        [userId]
      );
    }

    return res.status(201).json({
      message: role === 'provider'
        ? 'Provider registered! Your account is pending admin verification.'
        : 'Registration successful! You can now log in.',
      userId
    });

  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ message: 'Server error during registration' });
  }
}


// ─────────────────────────────────────────────
//  LOGIN
//  POST /api/auth/login
// ─────────────────────────────────────────────
async function login(req, res) {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ message: 'Phone and password are required' });
    }

    const encryptedPhone = encrypt(phone);

    const [users] = await db.query(
      'SELECT * FROM users WHERE phone = ?',
      [Buffer.from(encryptedPhone, 'hex')]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid phone number or password' });
    }

    const user = users[0];

    if (user.status === 'suspended') {
      return res.status(403).json({ message: 'Your account has been suspended. Contact support.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid phone number or password' });
    }

    // Create JWT token — works for ALL statuses including pending
    // Pending providers need this token to upload their documents
    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: user.status === 'pending' ? '1h' : process.env.JWT_EXPIRES_IN }
    );

    // If provider is pending — return token but flag as pending
    // Frontend will use token for document upload only
    if (user.role === 'provider' && user.status === 'pending') {
      return res.status(200).json({
        message: 'pending',
        token,
        user: { id: user.id, name: user.name, role: user.role, status: user.status }
      });
    }

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, role: user.role, status: user.status }
    });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Server error during login' });
  }
}


// ─────────────────────────────────────────────
//  GET MY PROFILE
//  GET /api/auth/me
// ─────────────────────────────────────────────
async function getMe(req, res) {
  try {
    const [users] = await db.query(
      'SELECT id, name, role, status, latitude, longitude, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({ user: users[0] });

  } catch (err) {
    console.error('GetMe error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { register, login, getMe };