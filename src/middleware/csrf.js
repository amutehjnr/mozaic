const crypto = require('crypto');

/**
 * Setup CSRF protection - attaches a fresh token to every response.
 */
const setupCsrf = () => {
    return (req, res, next) => {
        const token = crypto.randomBytes(32).toString('hex'); // 64 hex chars

        res.locals.csrfToken = token;
        req.csrfToken = () => token;

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
 * CSRF validation middleware.
 *
 * Accepts the token from any of:
 *   - req.body._csrf
 *   - req.headers['x-csrf-token']
 *   - req.headers['xsrf-token']
 *   - req.headers['x-xsrf-token']
 *   - req.cookies['XSRF-TOKEN']
 *
 * FIX: coerce token to string before calling .match() so the server
 * never throws "token.match is not a function" when the value is
 * null / undefined / a non-string (e.g. sent as JSON number/boolean).
 */
const csrfProtection = (req, res, next) => {
    // Skip safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // Only enforce in production
    if (process.env.NODE_ENV !== 'production') {
        return next();
    }

    // Collect candidate token from all possible locations
    const raw =
        req.body?._csrf             ||
        req.headers['x-csrf-token'] ||
        req.headers['xsrf-token']   ||
        req.headers['x-xsrf-token'] ||
        req.cookies?.['XSRF-TOKEN'] ||
        null;

    // --- FIX: always coerce to string before calling .match() ---
    const token = raw != null ? String(raw) : '';

    if (!token) {
        return res.status(403).json({
            ok: false,
            error: 'CSRF token missing'
        });
    }

    // Must be exactly 64 lowercase hex characters
    if (!/^[a-f0-9]{64}$/.test(token)) {
        return res.status(403).json({
            ok: false,
            error: 'Invalid CSRF token'
        });
    }

    next();
};

/**
 * Generate a standalone CSRF token (used by /api/csrf route).
 */
const generateToken = (req) => {
    return crypto.randomBytes(32).toString('hex');
};

module.exports = {
    setupCsrf,
    csrfProtection,
    generateToken
};