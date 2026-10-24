const express = require('express');
const Submission = require('../models/Submission');
const { optionalAuth } = require('../middleware/auth');
const { asyncHandler, HttpError, cleanText, cleanObject, isEmail } = require('../utils/helpers');

const router = express.Router();

// contact, job application, verification, partner, book-call all share one handler.
const FORMS = {
  '/contact': 'contact',
  '/job-application': 'job-application',
  '/verification': 'verification',
  '/partner': 'partner',
  '/book-call': 'book-call'
};

Object.entries(FORMS).forEach(([path, type]) => {
  router.post(path, optionalAuth, asyncHandler(async (req, res) => {
    const b = req.body || {};
    const email = cleanText(b.email, 254).toLowerCase();
    const phone = cleanText(b.phone || b.whatsapp, 30);
    const name = cleanText(b.name || `${b.firstName || ''} ${b.lastName || ''}`, 160);

    if (email && !isEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');
    if (!email && !phone) throw new HttpError(400, 'Please provide an email address or phone number.');

    // Documents and images must be sent as links; files are not accepted here.
    const data = cleanObject(b);
    await Submission.create({ type, name, email, phone, data, user: req.user ? req.user._id : undefined });
    res.status(201).json({ message: 'Thank you. We have received your request and will contact you soon.' });
  }));
});

module.exports = router;
