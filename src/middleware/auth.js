// =============================================
//  auth.js — JWT Middleware
//  This is like a security guard at a door.
//  Every protected API route calls this first.
//  If you don't have a valid token → blocked!
// =============================================

const jwt = require('jsonwebtoken');
require('dotenv').config();

// Protect any route — must be logged in
function verifyToken(req, res, next) {
  // Token comes in the request header like:
  // Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // get the part after "Bearer "

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    // Verify the token is real and not expired
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // attach user info to the request
    next(); // pass to the actual route handler
  } catch (err) {
    return res.status(403).json({ message: 'Invalid or expired token.' });
  }
}

// Only allow a specific role
// Usage: requireRole('admin') or requireRole('provider')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Access denied. Required role: ${roles.join(' or ')}`
      });
    }
    next();
  };
}

module.exports = { verifyToken, requireRole };