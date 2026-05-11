// =============================================
//  db.js — Database Connection
//  This file creates ONE connection pool that
//  the entire app shares. Think of it like a
//  shared phone line to the database.
// =============================================

const mysql = require('mysql2/promise');
require('dotenv').config();

// A "pool" means we keep several connections open
// so the app doesn't have to reconnect every time
const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,    // max 10 simultaneous DB operations
  queueLimit: 0
});

// Test the connection when the server starts
pool.getConnection()
  .then(conn => {
    console.log('✅ Database connected successfully!');
    conn.release(); // give the connection back to the pool
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

module.exports = pool;