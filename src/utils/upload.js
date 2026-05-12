// =============================================
//  src/utils/upload.js
//  Handles file uploads to Cloudinary
// =============================================

const cloudinary = require('cloudinary').v2;
const multer = require('multer');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Store files in memory temporarily
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed!'), false);
    }
  }
});

// Upload buffer to Cloudinary
async function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: `neighborhood-app/${folder}` },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    ).end(buffer);
  });
}

module.exports = { upload, uploadToCloudinary };