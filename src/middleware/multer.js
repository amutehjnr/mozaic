const multer = require('multer');
const path = require('path');

// Configure multer for memory storage (we don't need to save files for auth)
const storage = multer.memoryStorage();

// File filter to only allow text fields (no files needed for auth)
const fileFilter = (req, file, cb) => {
    // Reject any file uploads on auth routes
    cb(new Error('File upload not allowed on auth routes'), false);
};

// Create multer instance for auth routes
const authUpload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 1024 * 1024 // 1MB limit (though files are rejected)
    }
}).none(); // .none() means no files allowed, only text fields

// Middleware to handle multipart/form-data on auth routes
const handleMultipart = (req, res, next) => {
    // Check if it's multipart/form-data
    if (req.is('multipart/form-data')) {
        authUpload(req, res, (err) => {
            if (err) {
                console.error('Multer error:', err);
                return res.status(400).json({
                    ok: false,
                    error: 'Invalid form data'
                });
            }
            next();
        });
    } else {
        next();
    }
};

module.exports = { handleMultipart };