// File storage via Cloudinary SIGNED uploads. The browser uploads straight to Cloudinary using a
// short-lived signature issued by this API, so no files ever touch ephemeral serverless disk.
// Pending configuration until CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET are set.
const crypto = require('crypto');

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DOC_BYTES = 10 * 1024 * 1024;

const isConfigured = () => !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

// kind: 'image' (public) or 'document' (private/authenticated delivery, admin-only access)
function signUpload(kind, userId) {
  if (!isConfigured()) return null;
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    folder: `msukasha/${kind === 'document' ? 'private' : 'public'}/${userId}`,
    timestamp,
    type: kind === 'document' ? 'authenticated' : 'upload'
  };
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const signature = crypto.createHash('sha1').update(toSign + process.env.CLOUDINARY_API_SECRET).digest('hex');
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/${kind === 'document' ? 'auto' : 'image'}/upload`,
    apiKey: process.env.CLOUDINARY_API_KEY,
    ...params,
    signature,
    allowedTypes: kind === 'document' ? DOC_TYPES : IMAGE_TYPES,
    maxBytes: kind === 'document' ? MAX_DOC_BYTES : MAX_IMAGE_BYTES
  };
}

// Only accept URLs from our own Cloudinary account (prevents hot-linking arbitrary/malicious URLs).
function isOwnAssetUrl(url) {
  if (!process.env.CLOUDINARY_CLOUD_NAME) return false;
  return typeof url === 'string' && url.startsWith(`https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/`);
}

// Admin-only time-limited URL for private documents.
function signedPrivateUrl(publicId, format, ttlSeconds = 300) {
  if (!isConfigured()) return null;
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const toSign = `expires_at=${expires}&public_id=${publicId}&type=authenticated`;
  const signature = crypto.createHash('sha1').update(toSign + process.env.CLOUDINARY_API_SECRET).digest('hex');
  return `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/download?public_id=${encodeURIComponent(publicId)}&type=authenticated&expires_at=${expires}&api_key=${process.env.CLOUDINARY_API_KEY}&signature=${signature}${format ? `&format=${format}` : ''}`;
}

module.exports = { isConfigured, signUpload, isOwnAssetUrl, signedPrivateUrl, IMAGE_TYPES, DOC_TYPES, MAX_IMAGE_BYTES, MAX_DOC_BYTES };
