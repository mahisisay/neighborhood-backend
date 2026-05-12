// =============================================
//  provider.onboard.routes.js
//  Provider document upload endpoints
// =============================================

const express = require('express');
const router  = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../utils/upload');
const db = require('../config/db');

// POST /api/providers/onboard
// Provider uploads ID + certificate + experience
router.post('/onboard',
  verifyToken,
  requireRole('provider'),
  upload.fields([
    { name: 'id_document', maxCount: 1 },
    { name: 'certificate', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const providerId = req.user.id;
      const { experience_description } = req.body;

      if (!req.files?.id_document) {
        return res.status(400).json({ message: 'National ID photo is required' });
      }

      // Upload ID document to Cloudinary
      const idUrl = await uploadToCloudinary(
        req.files.id_document[0].buffer,
        'id_documents'
      );

      // Upload certificate if provided
      let certUrl = null;
      if (req.files?.certificate) {
        certUrl = await uploadToCloudinary(
          req.files.certificate[0].buffer,
          'certificates'
        );
      }

      // Update provider profile
      await db.query(
        `UPDATE provider_profiles
         SET id_document_url = ?,
             cert_url = ?,
             experience_description = ?
         WHERE user_id = ?`,
        [idUrl, certUrl, experience_description || null, providerId]
      );

      return res.status(200).json({
        message: '✅ Documents uploaded! Your account is pending admin verification.',
        id_document_url: idUrl,
        cert_url: certUrl
      });

    } catch (err) {
      console.error('Onboard error:', err);
      return res.status(500).json({ message: 'Server error uploading documents' });
    }
  }
);

module.exports = router;