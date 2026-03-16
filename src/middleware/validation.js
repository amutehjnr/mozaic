const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Validate request using express-validator
 */
const validate = (validations) => {
    return async (req, res, next) => {
        // Run all validations in parallel
        await Promise.all(validations.map(validation => validation.run(req)));

        const errors = validationResult(req);

        if (errors.isEmpty()) {
            return next();
        }

        const formattedErrors = errors.array().map(err => ({
            field:   err.path || err.param,
            message: err.msg,
        }));

        logger.debug('Validation errors:', { path: req.path, errors: formattedErrors });

        // AJAX / API requests → JSON
        if (req.xhr || req.path.startsWith('/api/') || req.headers.accept === 'application/json') {
            return res.status(422).json({
                ok:     false,
                error:  formattedErrors[0].message,
                errors: formattedErrors,
            });
        }

        // Web requests → flash + redirect
        req.flash('error', formattedErrors[0].message);
        req.session.formData = req.body;

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
                req.body[field] = req.body[field]
                    .replace(/<[^>]*>/g, '') // strip HTML
                    .trim()
                    .replace(/\s+/g, ' ');
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
                    ok:    false,
                    error: options.requiredMessage || 'File is required',
                });
            }
            return next();
        }

        const files = req.files || (req.file ? [req.file] : []);

        for (const file of files) {
            if (options.maxSize && file.size > options.maxSize) {
                return res.status(400).json({
                    ok:    false,
                    error: `File too large. Max size: ${options.maxSize / 1024 / 1024}MB`,
                });
            }
            if (options.allowedTypes && !options.allowedTypes.includes(file.mimetype)) {
                return res.status(400).json({
                    ok:    false,
                    error: `Invalid file type. Allowed: ${options.allowedTypes.join(', ')}`,
                });
            }
        }

        next();
    };
};

module.exports = { validate, sanitize, validateFile };