// =============================================
//  request.controller.js
//  Handles all service request logic:
//  - Create a request (seeker)
//  - Find nearby providers using GPS (Haversine formula)
//  - Accept / reject a job (provider)
//  - View requests
// =============================================

const db = require('../config/db');

// ─────────────────────────────────────────────
//  HAVERSINE FORMULA
//  Calculates distance between two GPS points
//  in kilometers. This is how we find providers
//  within 10km — pure math, no Google Maps needed
//  for the matching itself!
//
//  Think of it like measuring a straight line
//  between two points on a curved Earth.
// ─────────────────────────────────────────────
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // returns distance in km
}


// ─────────────────────────────────────────────
//  CREATE SERVICE REQUEST
//  POST /api/requests
//  Who can call: seeker only
//  Body: { category_id, description, latitude, longitude, photo_url? }
// ─────────────────────────────────────────────
async function createRequest(req, res) {
  try {
    const { category_id, description, latitude, longitude, photo_url } = req.body;
    const seekerId = req.user.id; // from JWT token

    // 1. Validate required fields
    if (!category_id || !description || !latitude || !longitude) {
      return res.status(400).json({
        message: 'category_id, description, latitude and longitude are required'
      });
    }

    // 2. Make sure the category exists
    const [cats] = await db.query('SELECT id FROM categories WHERE id = ?', [category_id]);
    if (cats.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }

    // 3. Save the service request
    const [result] = await db.query(
      `INSERT INTO service_requests
        (seeker_id, category_id, description, latitude, longitude, photo_url, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [seekerId, category_id, description, latitude, longitude, photo_url || null]
    );

    const requestId = result.insertId;

    // 4. Find matching providers within 10km
    //    We get ALL active online providers and filter by distance
    //    We never expose exact coordinates to providers!
    const [providers] = await db.query(
      `SELECT u.id, u.name, u.latitude, u.longitude, pp.avg_rating
       FROM users u
       JOIN provider_profiles pp ON pp.user_id = u.id
       WHERE u.role = 'provider'
         AND u.status = 'active'
         AND pp.is_online = true
         AND u.latitude IS NOT NULL
         AND u.longitude IS NOT NULL`
    );

    // 5. Filter providers within 10km using Haversine
    const nearbyProviders = providers.filter(p => {
      const dist = haversineDistance(latitude, longitude, p.latitude, p.longitude);
      return dist <= 10; // only within 10km
    });

    // 6. Create a job offer for each nearby provider
    //    Status = 'offered' means they've been notified but haven't responded yet
    for (const provider of nearbyProviders) {
      await db.query(
        `INSERT INTO job_assignments (request_id, provider_id, status)
         VALUES (?, ?, 'offered')`,
        [requestId, provider.id]
      );
    }

    return res.status(201).json({
      message: 'Service request created successfully!',
      requestId,
      nearbyProvidersNotified: nearbyProviders.length
    });

  } catch (err) {
    console.error('CreateRequest error:', err);
    return res.status(500).json({ message: 'Server error creating request' });
  }
}


// ─────────────────────────────────────────────
//  GET MY REQUESTS (Seeker sees their own requests)
//  GET /api/requests/my
//  Who can call: seeker only
// ─────────────────────────────────────────────
async function getMyRequests(req, res) {
  try {
    const seekerId = req.user.id;

    const [requests] = await db.query(
      `SELECT sr.id, sr.description, sr.status, sr.created_at,
              c.name AS category, c.icon AS category_icon,
              sr.photo_url
       FROM service_requests sr
       JOIN categories c ON c.id = sr.category_id
       WHERE sr.seeker_id = ?
       ORDER BY sr.created_at DESC`,
      [seekerId]
    );

    return res.status(200).json({ requests });

  } catch (err) {
    console.error('GetMyRequests error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}


// ─────────────────────────────────────────────
//  GET OFFERED JOBS (Provider sees jobs offered to them)
//  GET /api/requests/offered
//  Who can call: provider only
//  IMPORTANT: We show approximate distance, NOT exact location!
// ─────────────────────────────────────────────
async function getOfferedJobs(req, res) {
  try {
    const providerId = req.user.id;

    // Get provider's current location
    const [providerRows] = await db.query(
      'SELECT latitude, longitude FROM users WHERE id = ?',
      [providerId]
    );

    if (providerRows.length === 0) {
      return res.status(404).json({ message: 'Provider not found' });
    }

    const provLat = providerRows[0].latitude;
    const provLon = providerRows[0].longitude;

    // Get all jobs offered to this provider
    const [jobs] = await db.query(
      `SELECT ja.id AS assignment_id, ja.status AS assignment_status,
              sr.id AS request_id, sr.description, sr.created_at,
              sr.latitude AS req_lat, sr.longitude AS req_lon,
              c.name AS category, c.icon,
              u.name AS seeker_name
       FROM job_assignments ja
       JOIN service_requests sr ON sr.id = ja.request_id
       JOIN categories c ON c.id = sr.category_id
       JOIN users u ON u.id = sr.seeker_id
       WHERE ja.provider_id = ?
         AND ja.status = 'offered'
         AND sr.status = 'pending'
       ORDER BY sr.created_at DESC`,
      [providerId]
    );

    // Add approximate distance — NEVER exact coordinates!
    // We round to 1 decimal so provider knows roughly how far
    const jobsWithDistance = jobs.map(job => {
      let approxDistance = null;
      if (provLat && provLon) {
        const dist = haversineDistance(provLat, provLon, job.req_lat, job.req_lon);
        approxDistance = Math.round(dist * 10) / 10; // e.g. 2.3 km
      }
      // Remove exact coordinates from response — privacy!
      const { req_lat, req_lon, ...safeJob } = job;
      return { ...safeJob, distance_km: approxDistance };
    });

    return res.status(200).json({ jobs: jobsWithDistance });

  } catch (err) {
    console.error('GetOfferedJobs error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}


// ─────────────────────────────────────────────
//  ACCEPT JOB
//  POST /api/requests/:id/accept
//  Who can call: provider only
//  :id is the job_assignment id
// ─────────────────────────────────────────────
async function acceptJob(req, res) {
  try {
    const providerId   = req.user.id;
    const assignmentId = req.params.id;

    // 1. Find the assignment and make sure it belongs to this provider
    const [assignments] = await db.query(
      `SELECT ja.*, sr.status AS request_status
       FROM job_assignments ja
       JOIN service_requests sr ON sr.id = ja.request_id
       WHERE ja.id = ? AND ja.provider_id = ?`,
      [assignmentId, providerId]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ message: 'Job assignment not found' });
    }

    const assignment = assignments[0];

    // 2. Check it's still available
    if (assignment.status !== 'offered') {
      return res.status(400).json({ message: 'This job is no longer available' });
    }

    if (assignment.request_status !== 'pending') {
      return res.status(400).json({ message: 'This request has already been assigned' });
    }

    // 3. Accept this assignment
    await db.query(
      `UPDATE job_assignments SET status = 'accepted' WHERE id = ?`,
      [assignmentId]
    );

    // 4. Mark the service request as assigned
    await db.query(
      `UPDATE service_requests SET status = 'assigned' WHERE id = ?`,
      [assignment.request_id]
    );

    // 5. Reject all other providers who were offered this same job
    //    Fair play — once one accepts, others are released
    await db.query(
      `UPDATE job_assignments
       SET status = 'rejected'
       WHERE request_id = ? AND id != ? AND status = 'offered'`,
      [assignment.request_id, assignmentId]
    );

    return res.status(200).json({
      message: 'Job accepted! Please pay the 20 ETB service fee to unlock seeker contact details.',
      requestId: assignment.request_id
    });

  } catch (err) {
    console.error('AcceptJob error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}


// ─────────────────────────────────────────────
//  REJECT JOB
//  POST /api/requests/:id/reject
//  Who can call: provider only
// ─────────────────────────────────────────────
async function rejectJob(req, res) {
  try {
    const providerId   = req.user.id;
    const assignmentId = req.params.id;

    const [assignments] = await db.query(
      `SELECT * FROM job_assignments WHERE id = ? AND provider_id = ?`,
      [assignmentId, providerId]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ message: 'Job assignment not found' });
    }

    if (assignments[0].status !== 'offered') {
      return res.status(400).json({ message: 'Job already responded to' });
    }

    await db.query(
      `UPDATE job_assignments SET status = 'rejected' WHERE id = ?`,
      [assignmentId]
    );

    return res.status(200).json({ message: 'Job rejected successfully' });

  } catch (err) {
    console.error('RejectJob error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}


// ─────────────────────────────────────────────
//  GET ALL CATEGORIES
//  GET /api/requests/categories
//  Who can call: anyone (even guests)
// ─────────────────────────────────────────────
async function getCategories(req, res) {
  try {
    const [categories] = await db.query('SELECT * FROM categories ORDER BY name');
    return res.status(200).json({ categories });
  } catch (err) {
    console.error('GetCategories error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  createRequest,
  getMyRequests,
  getOfferedJobs,
  acceptJob,
  rejectJob,
  getCategories
};