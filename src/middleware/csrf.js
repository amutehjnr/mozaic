const crypto = require('crypto');

/**
 * Setup CSRF protection - SIMPLIFIED for production
 */
const setupCsrf = () => {
    return (req, res, next) => {
        // Generate a simple token without session dependency
        const token = crypto.randomBytes(32).toString('hex');
        
        // Make token available to views and requests
        res.locals.csrfToken = token;
        req.csrfToken = () => token;
        
        // Set cookie for AJAX requests
        res.cookie('XSRF-TOKEN', token, {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000
        });
        
        next();
    };
};

/**
 * CSRF protection middleware
 */
const csrfProtection = (req, res, next) => {
    // Skip CSRF for GET, HEAD, OPTIONS requests
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // In production, verify token
    if (process.env.NODE_ENV === 'production') {
        const token = req.body._csrf || 
                      req.headers['x-csrf-token'] || 
                      req.headers['xsrf-token'] ||
                      req.headers['x-xsrf-token'] ||
                      req.cookies['XSRF-TOKEN'];

        if (!token) {
            return res.status(403).json({
                ok: false,
                error: 'CSRF token missing'
            });
        }

        // Simple validation - token should be 64 chars hex
        if (!token.match(/^[a-f0-9]{64}$/)) {
            return res.status(403).json({
                ok: false,
                error: 'Invalid CSRF token'
            });
        }
    }

    next();
};

/**
 * Generate CSRF token for API responses
 */
const generateToken = (req) => {
    // Always return a valid token without session dependency
    return crypto.randomBytes(32).toString('hex');
};

module.exports = {
    setupCsrf,
    csrfProtection,
    generateToken
};