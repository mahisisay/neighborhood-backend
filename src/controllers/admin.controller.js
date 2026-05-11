// =============================================
//  admin.controller.js
//  Admin-only actions:
//  - See pending providers waiting for approval
//  - Verify/activate a provider
//  - Suspend a user
//  - View dashboard statistics
// =============================================

const db = require('../config/db');


// ─────────────────────────────────────────────
//  GET PENDING PROVIDERS
//  GET /api/admin/providers/pending
//  Who can call: admin only
// ─────────────────────────────────────────────
async function getPendingProviders(req, res) {
  try {
    const [providers] = await db.query(
      `SELECT u.id, u.name, u.created_at,
              pp.id_document_url, pp.cert_url
       FROM users u
       JOIN provider_profiles pp ON pp.user_id = u.id
       WHERE u.role = 'provider'
         AND u.status = 'pending'
       ORDER BY u.created_at ASC`
    );

    return res.status(200).json({
      pending_providers: providers,
      total: providers.length
    });

  } catch (err) {
    console.error('GetPendingProviders error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}


// ─────────────────────────────────────────────
//  VERIFY PROVIDER (Activate their account)
//  PATCH /api/admin/providers/:id/verify
//  Who can call: admin only
//  :id is the user id of the provider
// ─────────────────────────────────────────────
async function verifyProvider(req, res) {
  try {
    const providerId = req.params.id;

    // Check provider exists and is pending
    const [providers] = await db.query(
      `SELECT u.id, u.name, u.status, u.role
       FROM users u
       WHERE u.id = ? AND u.role = 'provider'`,
      [providerId]
    );

    if (providers.length === 0) {
      return res.status(404).json({ message: 'Provider not found' });
    }

    if (providers[0].status === 'active') {
      return res.status(400).json({ message: 'Provider is already active' });
    }

    // Activate the provider
    await db.query(
      `UPDATE users SET status = 'active' WHERE id = ?`,
      [providerId]
    );

    return res.status(200).json({
      message: `✅ Provider "${providers[0].name}" has been verified and activated!`,
      provider_id: providerId
    });

  } catch (err) {
    console.error('VerifyProvider error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}


// ─────────────────────────────────────────────
//  SUSPEND USER
//  PATCH /api/admin/users/:id/suspend
//  Who can call: admin only
//  Works for both seekers and providers
// ─────────────────────────────────────────────
async function suspendUser(req, res) {
  try {
    const userId = req.params.id;

    const [users] = await db.query(
      'SELECT id, name, role, status FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Admins cannot be suspended
    if (users[0].role === 'admin') {
      return res.status(403).json({ message: 'Cannot suspend an admin account' });
    }

    if (users[0].status === 'suspended') {
      return res.status(400).json({ message: 'User is already suspended' });
    }

    await db.query(
      `UPDATE users SET status = 'suspended' WHERE id = ?`,
      [userId]
    );

    // If provider, also take them offline
    if (users[0].role === 'provider') {
      await db.query(
        `UPDATE provider_profiles SET is_online = false WHERE user_id = ?`,
        [userId]
      );
    }

    return res.status(200).json({
      message: `⛔ User "${users[0].name}" has been suspended.`,
      user_id: userId
    });

  } catch (err) {
    console.error('SuspendUser error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}


// ─────────────────────────────────────────────
//  REACTIVATE USER
//  PATCH /api/admin/users/:id/reactivate
//  Who can call: admin only
// ─────────────────────────────────────────────
async function reactivateUser(req, res) {
  try {
    const userId = req.params.id;

    const [users] = await db.query(
      'SELECT id, name, status FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    await db.query(
      `UPDATE users SET status = 'active' WHERE id = ?`,
      [userId]
    );

    return res.status(200).json({
      message: `✅ User "${users[0].name}" has been reactivated.`
    });

  } catch (err) {
    console.error('ReactivateUser error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}


// ─────────────────────────────────────────────
//  DASHBOARD STATS
//  GET /api/admin/stats
//  Who can call: admin only
//  Returns key numbers for the admin dashboard
// ─────────────────────────────────────────────
async function getDashboardStats(req, res) {
  try {
    // Run all queries at the same time for speed
    const [
      [totalUsers],
      [totalProviders],
      [pendingProviders],
      [totalRequests],
      [completedJobs],
      [totalRevenue]
    ] = await Promise.all([
      db.query(`SELECT COUNT(*) AS count FROM users WHERE role = 'seeker'`),
      db.query(`SELECT COUNT(*) AS count FROM users WHERE role = 'provider' AND status = 'active'`),
      db.query(`SELECT COUNT(*) AS count FROM users WHERE role = 'provider' AND status = 'pending'`),
      db.query(`SELECT COUNT(*) AS count FROM service_requests`),
      db.query(`SELECT COUNT(*) AS count FROM job_assignments WHERE status = 'completed'`),
      db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'completed'`)
    ]);

    return res.status(200).json({
      stats: {
        total_seekers:      totalUsers[0].count,
        active_providers:   totalProviders[0].count,
        pending_providers:  pendingProviders[0].count,
        total_requests:     totalRequests[0].count,
        completed_jobs:     completedJobs[0].count,
        total_revenue_ETB:  totalRevenue[0].total
      }
    });

  } catch (err) {
    console.error('GetDashboardStats error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}


// ─────────────────────────────────────────────
//  GET ALL USERS
//  GET /api/admin/users
//  Who can call: admin only
// ─────────────────────────────────────────────
async function getAllUsers(req, res) {
  try {
    const [users] = await db.query(
      `SELECT id, name, role, status, created_at
       FROM users
       ORDER BY created_at DESC`
    );

    return res.status(200).json({ users });

  } catch (err) {
    console.error('GetAllUsers error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  getPendingProviders,
  verifyProvider,
  suspendUser,
  reactivateUser,
  getDashboardStats,
  getAllUsers
};