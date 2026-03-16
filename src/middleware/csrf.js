const Tokens = require('csrf');
const crypto = require('crypto');
const logger = require('../utils/logger');

const tokens = new Tokens();

/**
 * Setup CSRF protection - FIXED: This is a middleware factory
 */
const setupCsrf = () => {
    return (req, res, next) => {
        try {
            // Generate or retrieve CSRF secret from session
            if (!req.session) {
                return next();
            }

            if (!req.session.csrfSecret) {
                req.session.csrfSecret = tokens.secretSync();
            }
            
            // Generate token for this request
            const token = tokens.create(req.session.csrfSecret);
            
            // Make token available to views and requests
            res.locals.csrfToken = token;
            req.csrfToken = () => token;
            
            // Also set in cookie for AJAX requests
            res.cookie('XSRF-TOKEN', token, {
                httpOnly: false,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000 // 24 hours
            });
            
            next();
        } catch (error) {
            console.error('CSRF setup error:', error);
            // Continue even if CSRF fails (for development)
            res.locals.csrfToken = 'dev-token';
            req.csrfToken = () => 'dev-token';
            next();
        }
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

    // Skip CSRF in development if needed (temporary)
    if (process.env.NODE_ENV !== 'production') {
        return next();
    }

    try {
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
    } catch (error) {
        console.error('CSRF protection error:', error);
        // In development, continue even if CSRF fails
        if (process.env.NODE_ENV !== 'production') {
            return next();
        }
        
        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(500).json({
                ok: false,
                error: 'Security error'
            });
        }
        
        req.flash('error', 'Security error');
        res.redirect('back');
    }
};

/**
 * Generate CSRF token for API responses
 */
const generateToken = (req) => {
    console.log('🔑 generateToken called');
    console.log('   Session exists:', !!req.session);
    
    try {
        if (!req.session) {
            throw new Error('No session available');
        }
        
        if (!req.session.csrfSecret) {
            console.log('   Creating new CSRF secret');
            req.session.csrfSecret = tokens.secretSync();
        }
        
        const token = tokens.create(req.session.csrfSecret);
        console.log('   ✅ Token created successfully');
        return token;
        
    } catch (error) {
        console.error('❌ generateToken error:');
        console.error('   Name:', error.name);
        console.error('   Message:', error.message);
        console.error('   Stack:', error.stack);
        // Return fallback instead of throwing
        return 'fallback-token-' + Date.now();
    }
};

module.exports = {
    setupCsrf,
    csrfProtection,
    generateToken
};