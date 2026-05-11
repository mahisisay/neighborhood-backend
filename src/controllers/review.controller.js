// =============================================
//  review.controller.js
//  Handles reviews and ratings:
//  - Seeker rates provider after job done
//  - Get all reviews for a provider
//  The database trigger auto-updates avg_rating!
// =============================================

const db = require('../config/db');


// ─────────────────────────────────────────────
//  SUBMIT REVIEW
//  POST /api/reviews
//  Who can call: seeker only
//  Body: { request_id, rating, comment }
// ─────────────────────────────────────────────
async function submitReview(req, res) {
  try {
    const { request_id, rating, comment } = req.body;
    const seekerId = req.user.id;

    // 1. Validate inputs
    if (!request_id || !rating) {
      return res.status(400).json({ message: 'request_id and rating are required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    // 2. Find the completed job for this request
    const [assignments] = await db.query(
      `SELECT ja.provider_id, sr.seeker_id, sr.status
       FROM job_assignments ja
       JOIN service_requests sr ON sr.id = ja.request_id
       WHERE ja.request_id = ?
         AND ja.status = 'accepted'`,
      [request_id]
    );

    if (assignments.length === 0) {
      return res.status(404).json({ message: 'No accepted job found for this request' });
    }

    const assignment = assignments[0];

    // 3. Make sure the seeker owns this request
    if (assignment.seeker_id !== seekerId) {
      return res.status(403).json({ message: 'You can only review your own requests' });
    }

    // 4. Check review doesn't already exist
    const [existing] = await db.query(
      'SELECT id FROM reviews WHERE request_id = ?',
      [request_id]
    );

    if (existing.length > 0) {
      return res.status(400).json({ message: 'You have already reviewed this job' });
    }

    // 5. Save the review
    //    The database trigger will auto-update provider's avg_rating!
    await db.query(
      `INSERT INTO reviews (seeker_id, provider_id, request_id, rating, comment)
       VALUES (?, ?, ?, ?, ?)`,
      [seekerId, assignment.provider_id, request_id, rating, comment || null]
    );

    // 6. Mark job as completed
    await db.query(
      `UPDATE job_assignments SET status = 'completed' WHERE request_id = ?`,
      [request_id]
    );

    await db.query(
      `UPDATE service_requests SET status = 'completed' WHERE id = ?`,
      [request_id]
    );

    return res.status(201).json({
      message: '⭐ Review submitted! Thank you for your feedback.',
      rating,
      provider_id: assignment.provider_id
    });

  } catch (err) {
    console.error('SubmitReview error:', err);
    return res.status(500).json({ message: 'Server error submitting review' });
  }
}


// ─────────────────────────────────────────────
//  GET PROVIDER REVIEWS
//  GET /api/reviews/provider/:id
//  Who can call: anyone
// ─────────────────────────────────────────────
async function getProviderReviews(req, res) {
  try {
    const providerId = req.params.id;

    // Get all reviews + average rating
    const [reviews] = await db.query(
      `SELECT r.id, r.rating, r.comment, r.created_at,
              u.name AS seeker_name
       FROM reviews r
       JOIN users u ON u.id = r.seeker_id
       WHERE r.provider_id = ?
       ORDER BY r.created_at DESC`,
      [providerId]
    );

    // Get the average rating from provider_profiles
    const [profile] = await db.query(
      'SELECT avg_rating FROM provider_profiles WHERE user_id = ?',
      [providerId]
    );

    return res.status(200).json({
      provider_id: providerId,
      avg_rating:  profile.length > 0 ? profile[0].avg_rating : 0,
      total_reviews: reviews.length,
      reviews
    });

  } catch (err) {
    console.error('GetProviderReviews error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { submitReview, getProviderReviews };