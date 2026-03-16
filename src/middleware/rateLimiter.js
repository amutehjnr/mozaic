const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV !== 'production';

// Log rate limiter status
if (isDevelopment) {
    console.log('🔧 Rate limiting is in DEVELOPMENT mode (limits are higher)');
} else {
    console.log('🔒 Rate limiting is in PRODUCTION mode (standard limits apply)');
}

/**
 * General API rate limiter - Using memory store (no MongoDB dependency)
 */
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isDevelopment ? 1000 : 100, // Higher limit in development
    message: {
        ok: false,
        error: 'Too many requests, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Use user ID if authenticated, otherwise IP
        return req.user?._id?.toString() || req.ip;
    },
    handler: (req, res) => {
        logger.warn('Rate limit exceeded', {
            ip: req.ip,
            path: req.path,
            userId: req.user?._id
        });

        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(429).json({
                ok: false,
                error: 'Too many requests, please try again later.'
            });
        }

        if (req.flash) {
            req.flash('error', 'Too many requests, please try again later.');
        }
        res.redirect('back');
    },
    skip: (req) => {
        // Skip rate limiting for admins
        return req.user?.role === 'admin' || req.user?.role === 'superadmin';
    }
});

/**
 * Stricter rate limiter for auth endpoints - Using memory store
 */
const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: isDevelopment ? 1000 : 10, // Much higher limit in development
    message: {
        ok: false,
        error: 'Too many authentication attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Always use IP for auth endpoints
        return req.ip;
    },
    // Skip rate limiting in development mode entirely
    skip: (req) => {
        // Skip for development
        if (isDevelopment) {
            return true;
        }
        return false;
    },
    handler: (req, res) => {
        logger.warn('Auth rate limit exceeded', {
            ip: req.ip,
            path: req.path
        });

        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(429).json({
                ok: false,
                error: 'Too many authentication attempts, please try again later.'
            });
        }

        if (req.flash) {
            req.flash('error', 'Too many authentication attempts, please try again later.');
        }
        res.redirect('/auth');
    }
});

/**
 * Rate limiter for wallet operations - Using memory store
 */
const walletLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: isDevelopment ? 500 : 50, // Higher in development
    message: {
        ok: false,
        error: 'Too many wallet operations, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.user?._id?.toString() || req.ip;
    }
});

/**
 * Rate limiter for bill payments - Using memory store
 */
const billLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: isDevelopment ? 1000 : 100, // Higher in development
    message: {
        ok: false,
        error: 'Too many payment attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Create custom rate limiter
 */
const createLimiter = (options) => {
    return rateLimit({
        windowMs: options.windowMs || 15 * 60 * 1000,
        max: isDevelopment ? (options.max || 100) * 10 : (options.max || 100),
        message: options.message || {
            ok: false,
            error: 'Too many requests, please try again later.'
        },
        keyGenerator: options.keyGenerator,
        skip: options.skip
    });
};

module.exports = {
    api: apiLimiter,
    auth: authLimiter,
    wallet: walletLimiter,
    bill: billLimiter,
    createLimiter
};