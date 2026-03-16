const Tokens = require('csrf');
const crypto = require('crypto');
const logger = require('../utils/logger');

const tokens = new Tokens();

/**
 * Setup CSRF protection - FIXED with proper error handling
 */
const setupCsrf = () => {
    return (req, res, next) => {
        // CRITICAL FIX: Check if session exists and is ready
        if (!req.session) {
            console.warn('⚠️ CSRF: No session available, skipping');
            res.locals.csrfToken = 'no-session';
            req.csrfToken = () => 'no-session';
            return next();
        }

        try {
            // Generate or retrieve CSRF secret from session
            if (!req.session.csrfSecret) {
                req.session.csrfSecret = tokens.secretSync();
                
                // Save session immediately to ensure it persists
                if (req.session.save) {
                    req.session.save();
                }
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
            console.error('❌ CSRF setup error:', error);
            // Provide fallback tokens to prevent crashes
            res.locals.csrfToken = 'fallback-token';
            req.csrfToken = () => 'fallback-token';
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

        // Verify token if session exists
        if (req.session && req.session.csrfSecret) {
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
        }

        next();
    } catch (error) {
        console.error('CSRF protection error:', error);
        
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
    try {
        if (!req.session) {
            console.warn('generateToken: No session available');
            return 'fallback-token-' + Date.now();
        }
        
        if (!req.session.csrfSecret) {
            req.session.csrfSecret = tokens.secretSync();
        }
        
        return tokens.create(req.session.csrfSecret);
    } catch (error) {
        console.error('generateToken error:', error);
        return 'fallback-token-' + Date.now();
    }
};

module.exports = {
    setupCsrf,
    csrfProtection,
    generateToken
};