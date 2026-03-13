const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const crypto = require('crypto');
const logger = require('../utils/logger');

// Ensure upload directories exist
const createUploadDir = (dir) => {
    const fullPath = path.join(__dirname, '../../public', dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
    return fullPath;
};

// Create required directories
createUploadDir('/uploads/profile');
createUploadDir('/uploads/kyc');
createUploadDir('/uploads/receipts');
createUploadDir('/uploads/temp');

/**
 * Generate unique filename
 */
const generateFilename = (originalname, prefix = '') => {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(originalname);
    return `${prefix}${timestamp}-${random}${ext}`;
};

/**
 * Storage configuration
 */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let uploadPath = '/uploads/temp';
        
        // Determine upload path based on field name
        if (file.fieldname === 'photo' || file.fieldname === 'avatar') {
            uploadPath = '/uploads/profile';
        } else if (file.fieldname.includes('id') || file.fieldname === 'selfie') {
            uploadPath = '/uploads/kyc';
        } else if (file.fieldname === 'receipt') {
            uploadPath = '/uploads/receipts';
        }
        
        const fullPath = path.join(__dirname, '../../public', uploadPath);
        cb(null, fullPath);
    },
    filename: (req, file, cb) => {
        const prefix = file.fieldname === 'photo' ? 'profile-' : 
                      file.fieldname.includes('id') ? 'id-' : 
                      file.fieldname === 'selfie' ? 'selfie-' : '';
        
        const filename = generateFilename(file.originalname, prefix);
        cb(null, filename);
    }
});

/**
 * File filter
 */
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'application/pdf'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF are allowed.'), false);
    }
};

/**
 * Multer upload instance
 */
const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // 5MB default
        files: 5 // Max 5 files per request
    },
    fileFilter: fileFilter
});

/**
 * Optimize image middleware
 */
const optimizeImage = async (req, res, next) => {
    try {
        if (!req.file && !req.files) {
            return next();
        }

        const files = req.files || (req.file ? [req.file] : []);
        
        for (const file of files) {
            // Skip non-image files
            if (!file.mimetype.startsWith('image/') || file.mimetype === 'image/gif') {
                continue;
            }

            const filePath = file.path;
            const parsedPath = path.parse(filePath);
            const optimizedPath = path.join(parsedPath.dir, `optimized-${parsedPath.base}`);

            // Optimize image
            await sharp(filePath)
                .resize(1200, 1200, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .jpeg({ quality: 80, progressive: true })
                .toFile(optimizedPath);

            // Replace original with optimized
            fs.unlinkSync(filePath);
            fs.renameSync(optimizedPath, filePath);

            // Update file size
            const stats = fs.statSync(filePath);
            file.size = stats.size;
        }

        next();
    } catch (error) {
        logger.error('Image optimization error:', error);
        next();
    }
};

/**
 * Clean up temp files
 */
const cleanupTemp = async (req, res, next) => {
    // Store original end function
    const originalEnd = res.end;
    
    // Override end function
    res.end = function(...args) {
        // Clean up temp files after response is sent
        if (req.file || req.files) {
            const files = req.files || (req.file ? [req.file] : []);
            
            files.forEach(file => {
                // Only delete if it's in temp directory
                if (file.path.includes('/temp/')) {
                    fs.unlink(file.path, (err) => {
                        if (err) logger.error('Failed to delete temp file:', err);
                    });
                }
            });
        }
        
        originalEnd.apply(res, args);
    };
    
    next();
};

/**
 * Handle multer errors
 */
const handleUploadError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                ok: false,
                error: 'File too large. Maximum size is 5MB.'
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                ok: false,
                error: 'Too many files. Maximum is 5.'
            });
        }
        return res.status(400).json({
            ok: false,
            error: `Upload error: ${err.message}`
        });
    }
    
    if (err.message.includes('Invalid file type')) {
        return res.status(400).json({
            ok: false,
            error: err.message
        });
    }
    
    next(err);
};

module.exports = upload;
module.exports.optimizeImage = optimizeImage;
module.exports.cleanupTemp = cleanupTemp;
module.exports.handleUploadError = handleUploadError;