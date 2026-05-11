// =============================================
//  auth.controller.js — Register & Login Logic
//  This is the actual brain behind auth.
//  Routes call these functions.
// =============================================

const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../config/db');
const { encrypt, decrypt } = require('../utils/encryption');
require('dotenv').config();

// ─────────────────────────────────────────────
//  REGISTER
//  POST /api/auth/register
//  Body: { name, phone, password, role }
//  Role can be: "seeker" or "provider"
// ─────────────────────────────────────────────
async function register(req, res) {
  try {
    const { name, phone, password, role } = req.body;

    // 1. Validate required fields
    if (!name || !phone || !password || !role) {
      return res.status(400).json({ message: 'All fields are required: name, phone, password, role' });
    }

    // 2. Only allow seeker or provider to self-register
    //    Admins are created manually in the database
    if (!['seeker', 'provider'].includes(role)) {
      return res.status(400).json({ message: 'Role must be seeker or provider' });
    }

    // 3. Encrypt the phone number before checking/saving
    const encryptedPhone = encrypt(phone);

    // 4. Check if phone already registered
    //    We compare encrypted values since that's what's stored
    const [existing] = await db.query(
      'SELECT id FROM users WHERE phone = ?',
      [Buffer.from(encryptedPhone, 'hex')]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Phone number already registered' });
    }

    // 5. Hash the password — NEVER store plain text passwords!
    //    bcrypt cost factor 12 = strong but not too slow
    const passwordHash = await bcrypt.hash(password, 12);

    // 6. Providers start as 'pending' until admin verifies them
    //    Seekers start as 'active' immediately
    const status = role === 'provider' ? 'pending' : 'active';

    // 7. Save user to database
    const [result] = await db.query(
      `INSERT INTO users (name, phone, password_hash, role, status)
       VALUES (?, ?, ?, ?, ?)`,
      [name, Buffer.from(encryptedPhone, 'hex'), passwordHash, role, status]
    );

    const userId = result.insertId;

    // 8. If provider, create their profile row too
    if (role === 'provider') {
      await db.query(
        'INSERT INTO provider_profiles (user_id) VALUES (?)',
        [userId]
      );
    }

    // 9. Send success response
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
//  Body: { phone, password }
//  Returns: JWT token + user info
// ─────────────────────────────────────────────
async function login(req, res) {
  try {
    const { phone, password } = req.body;

    // 1. Validate fields
    if (!phone || !password) {
      return res.status(400).json({ message: 'Phone and password are required' });
    }

    // 2. Encrypt phone to search in database
    const encryptedPhone = encrypt(phone);

    // 3. Find user by encrypted phone
    const [users] = await db.query(
      'SELECT * FROM users WHERE phone = ?',
      [Buffer.from(encryptedPhone, 'hex')]
    );

    if (users.length === 0) {
      // Don't say "phone not found" — just say invalid credentials
      // This prevents attackers from guessing valid phone numbers
      return res.status(401).json({ message: 'Invalid phone number or password' });
    }

    const user = users[0];

    // 4. Check if account is suspended
    if (user.status === 'suspended') {
      return res.status(403).json({ message: 'Your account has been suspended. Contact support.' });
    }

    // 5. Check if provider is still pending
    if (user.role === 'provider' && user.status === 'pending') {
      return res.status(403).json({
        message: 'Your provider account is pending verification. Please wait for admin approval.'
      });
    }

    // 6. Compare password with stored hash
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid phone number or password' });
    }

    // 7. Create JWT token
    //    This token proves who the user is on every future request
    const token = jwt.sign(
      {
        id:   user.id,
        role: user.role,
        name: user.name
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN } // expires in 7 days
    );

    // 8. Send token + user info back to the app
    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id:     user.id,
        name:   user.name,
        role:   user.role,
        status: user.status
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Server error during login' });
  }
}


// ─────────────────────────────────────────────
//  GET MY PROFILE
//  GET /api/auth/me
//  Requires: valid JWT token in header
// ─────────────────────────────────────────────
async function getMe(req, res) {
  try {
    // req.user is set by the verifyToken middleware
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