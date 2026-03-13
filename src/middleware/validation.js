const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Validate request using express-validator
 */
const validate = (validations) => {
    return async (req, res, next) => {
        // DEBUG: Log the entire request body
        console.log('\n🔍 ========== VALIDATION DEBUG ==========');
        console.log('Request URL:', req.url);
        console.log('Request method:', req.method);
        console.log('Content-Type:', req.headers['content-type']);
        console.log('Is AJAX:', req.xhr || req.headers.accept === 'application/json');
        
        console.log('\n📦 Request Body:');
        console.log(JSON.stringify(req.body, null, 2));
        
        // Detailed password debugging
        if (req.body.password) {
            console.log('\n🔐 PASSWORD DEBUG:');
            console.log('   Raw value:', req.body.password);
            console.log('   Type:', typeof req.body.password);
            console.log('   Length:', req.body.password.length);
            console.log('   Characters:');
            for (let i = 0; i < req.body.password.length; i++) {
                const char = req.body.password[i];
                const code = req.body.password.charCodeAt(i);
                console.log(`     [${i}]: '${char}' (ASCII: ${code})`);
            }
            
            // Check for hidden characters
            const hasHiddenChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(req.body.password);
            if (hasHiddenChars) {
                console.log('   ⚠️  Contains hidden control characters!');
            }
        } else {
            console.log('\n❌ No password field in request!');
        }

        // Run all validations in parallel
        await Promise.all(validations.map(validation => validation.run(req)));

        const errors = validationResult(req);
        
        if (errors.isEmpty()) {
            console.log('\n✅ Validation passed successfully');
            console.log('=====================================\n');
            return next();
        }

        console.log('\n❌ Validation failed:');
        console.log(JSON.stringify(errors.array(), null, 2));

        const formattedErrors = errors.array().map(err => ({
            field: err.path || err.param,
            message: err.msg,
            value: err.value // Include the value that caused the error
        }));

        logger.debug('Validation errors:', {
            path: req.path,
            errors: formattedErrors
        });

        // Handle different response types
        if (req.xhr || req.path.startsWith('/api/') || req.headers.accept === 'application/json') {
            return res.status(422).json({
                ok: false,
                error: formattedErrors[0].message,
                errors: formattedErrors
            });
        }

        // For web requests, flash first error and redirect back
        req.flash('error', formattedErrors[0].message);
        
        // Preserve form data for refilling the form
        req.session.formData = req.body;
        
        console.log('=====================================\n');
        const redirectUrl = req.get('Referrer') || '/';
        res.redirect(redirectUrl);
    };
};

/**
 * Sanitize input data
 */
const sanitize = (fields) => {
    return (req, res, next) => {
        fields.forEach(field => {
            if (req.body[field]) {
                // Remove HTML tags
                req.body[field] = req.body[field].replace(/<[^>]*>/g, '');
                // Trim whitespace
                req.body[field] = req.body[field].trim();
                // Remove multiple spaces
                req.body[field] = req.body[field].replace(/\s+/g, ' ');
            }
        });
        next();
    };
};

/**
 * Validate file upload
 */
const validateFile = (options = {}) => {
    return (req, res, next) => {
        if (!req.file && !req.files) {
            if (options.required) {
                return res.status(400).json({
                    ok: false,
                    error: options.requiredMessage || 'File is required'
                });
            }
            return next();
        }

        const files = req.files || (req.file ? [req.file] : []);
        
        for (const file of files) {
            // Check file size
            if (options.maxSize && file.size > options.maxSize) {
                return res.status(400).json({
                    ok: false,
                    error: `File too large. Max size: ${options.maxSize / 1024 / 1024}MB`
                });
            }

            // Check file type
            if (options.allowedTypes && !options.allowedTypes.includes(file.mimetype)) {
                return res.status(400).json({
                    ok: false,
                    error: `Invalid file type. Allowed: ${options.allowedTypes.join(', ')}`
                });
            }
        }

        next();
    };
};

module.exports = {
    validate,
    sanitize,
    validateFile
};