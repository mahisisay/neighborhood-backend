// =============================================
//  provider.controller.js
//  Handles provider-specific actions:
//  - Toggle online/offline status
//  - Update GPS location
//  - Get nearby providers (for seekers browsing)
// =============================================

const db = require('../config/db');

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


// ─────────────────────────────────────────────
//  TOGGLE ONLINE / OFFLINE
//  PATCH /api/providers/toggle-status
//  Who can call: provider only
//  Body: { latitude, longitude }
//  Provider must send their GPS when going online
// ─────────────────────────────────────────────
async function toggleStatus(req, res) {
  try {
    const providerId = req.user.id;
    const { latitude, longitude } = req.body;

    // Get current online status
    const [profiles] = await db.query(
      'SELECT is_online FROM provider_profiles WHERE user_id = ?',
      [providerId]
    );

    if (profiles.length === 0) {
      return res.status(404).json({ message: 'Provider profile not found' });
    }

    const currentlyOnline = profiles[0].is_online;
    const goingOnline = !currentlyOnline; // flip it

    // If going online, GPS location is required
    if (goingOnline && (!latitude || !longitude)) {
      return res.status(400).json({
        message: 'latitude and longitude are required when going online'
      });
    }

    // Update online status in provider_profiles
    await db.query(
      'UPDATE provider_profiles SET is_online = ? WHERE user_id = ?',
      [goingOnline, providerId]
    );

    // Update GPS location in users table
    if (goingOnline) {
      await db.query(
        'UPDATE users SET latitude = ?, longitude = ? WHERE id = ?',
        [latitude, longitude, providerId]
      );
    }

    return res.status(200).json({
      message: goingOnline
        ? '✅ You are now ONLINE and will receive job notifications!'
        : '⏸️ You are now OFFLINE. You will not receive new jobs.',
      is_online: goingOnline
    });

  } catch (err) {
    console.error('ToggleStatus error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}


// ─────────────────────────────────────────────
//  GET NEARBY PROVIDERS
//  GET /api/providers/nearby?lat=9.03&lon=38.74&category_id=1
//  Who can call: anyone (seekers browsing)
//  Shows approximate distance only — never exact location!
// ─────────────────────────────────────────────
async function getNearbyProviders(req, res) {
  try {
    const { lat, lon, category_id } = req.query;

    if (!lat || !lon) {
      return res.status(400).json({ message: 'lat and lon query params are required' });
    }

    // Get all active online providers
    const [providers] = await db.query(
      `SELECT u.id, u.name, u.latitude, u.longitude,
              pp.avg_rating, pp.is_online
       FROM users u
       JOIN provider_profiles pp ON pp.user_id = u.id
       WHERE u.role = 'provider'
         AND u.status = 'active'
         AND pp.is_online = true
         AND u.latitude IS NOT NULL
         AND u.longitude IS NOT NULL`
    );

    // Filter by 10km radius and add approximate distance
    const nearby = providers
      .map(p => {
        const dist = haversineDistance(
          parseFloat(lat), parseFloat(lon),
          p.latitude, p.longitude
        );
        return { ...p, distance_km: Math.round(dist * 10) / 10 };
      })
      .filter(p => p.distance_km <= 10)
      .sort((a, b) => a.distance_km - b.distance_km); // closest first

    // Remove exact coordinates from response — privacy!
    const safeProviders = nearby.map(({ latitude, longitude, ...p }) => p);

    return res.status(200).json({
      providers: safeProviders,
      total: safeProviders.length
    });

  } catch (err) {
    console.error('GetNearbyProviders error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { toggleStatus, getNearbyProviders };