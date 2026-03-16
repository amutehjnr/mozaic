const multer = require('multer');
const path = require('path');

// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter - only reject actual files, allow text fields
const fileFilter = (req, file, cb) => {
    // Check if it's actually a file upload (has originalname)
    if (file && file.originalname) {
        // Reject actual file uploads on auth routes
        cb(new Error('File upload not allowed on auth routes'), false);
    } else {
        // Allow text fields
        cb(null, true);
    }
};

// Create multer instance for auth routes
const authUpload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 1024 * 1024, // 1MB limit
        fields: 20, // Maximum number of text fields
        fieldSize: 1024 * 1024 // Maximum field value size (1MB)
    }
});

// Middleware to handle multipart/form-data on auth routes
const handleMultipart = (req, res, next) => {
    // Check if it's multipart/form-data
    if (req.is('multipart/form-data')) {
        // Use .any() to accept all fields but filter will reject actual files
        const upload = authUpload.any();
        
        upload(req, res, (err) => {
            if (err) {
                console.error('Multer error:', err);
                // Check if it's a file upload error
                if (err.message === 'File upload not allowed on auth routes') {
                    return res.status(400).json({
                        ok: false,
                        error: 'File uploads are not allowed'
                    });
                }
                return res.status(400).json({
                    ok: false,
                    error: 'Invalid form data'
                });
            }
            
            // Convert multer's array format back to req.body object
            if (req.files && req.files.length > 0) {
                // This shouldn't happen due to fileFilter, but just in case
                return res.status(400).json({
                    ok: false,
                    error: 'File uploads are not allowed'
                });
            }
            
            next();
        });
    } else {
        next();
    }
};

module.exports = { handleMultipart };