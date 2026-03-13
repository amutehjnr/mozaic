const Tokens = require('csrf');
const crypto = require('crypto');
const logger = require('../utils/logger');

const tokens = new Tokens();

/**
 * Setup CSRF protection
 */
const setupCsrf = (app) => {
    app.use((req, res, next) => {
        // Generate or retrieve CSRF secret from session
        if (!req.session.csrfSecret) {
            req.session.csrfSecret = tokens.secretSync();
        }
        
        // Generate token for this request
        const token = tokens.create(req.session.csrfSecret);
        
        // Make token available to views
        res.locals.csrfToken = token;
        
        // Also set in cookie for AJAX requests
        res.cookie('XSRF-TOKEN', token, {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
        
        next();
    });
};

/**
 * CSRF protection middleware
 */
const csrfProtection = (req, res, next) => {
    // Skip CSRF for GET, HEAD, OPTIONS requests
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // Get token from various sources
    const token = req.body._csrf || 
                  req.headers['x-csrf-token'] || 
                  req.headers['xsrf-token'] ||
                  req.headers['x-xsrf-token'] ||
                  req.cookies['XSRF-TOKEN'];

    if (!token) {
        logger.warn('CSRF token missing', {
            method: req.method,
            path: req.path,
            ip: req.ip
        });

        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(403).json({
                ok: false,
                error: 'CSRF token missing'
            });
        }

        req.flash('error', 'Security token missing');
        return res.redirect('back');
    }

    // Verify token
    if (!tokens.verify(req.session.csrfSecret, token)) {
        logger.warn('CSRF token invalid', {
            method: req.method,
            path: req.path,
            ip: req.ip
        });

        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(403).json({
                ok: false,
                error: 'Invalid CSRF token'
            });
        }

        req.flash('error', 'Invalid security token');
        return res.redirect('back');
    }

    next();
};

/**
 * Generate CSRF token for API responses
 */
const generateToken = (req) => {
    if (!req.session.csrfSecret) {
        req.session.csrfSecret = tokens.secretSync();
    }
    return tokens.create(req.session.csrfSecret);
};

module.exports = {
    setupCsrf,
    csrfProtection,
    generateToken
};