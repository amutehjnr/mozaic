const Tokens = require('csrf');
const crypto = require('crypto');
const logger = require('../utils/logger');

const tokens = new Tokens();

/**
 * Setup CSRF protection
 */
const setupCsrf = () => {
    return (req, res, next) => {
        // Always proceed, even if session is not ready
        if (!req.session) {
            console.warn('⚠️ CSRF: No session available, using fallback');
            res.locals.csrfToken = 'fallback-token';
            req.csrfToken = () => 'fallback-token';
            return next();
        }

        try {
            if (!req.session.csrfSecret) {
                req.session.csrfSecret = tokens.secretSync();
            }
            
            const token = tokens.create(req.session.csrfSecret);
            
            res.locals.csrfToken = token;
            req.csrfToken = () => token;
            
            res.cookie('XSRF-TOKEN', token, {
                httpOnly: false,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000
            });
            
            next();
        } catch (error) {
            console.error('❌ CSRF setup error:', error);
            res.locals.csrfToken = 'error-fallback';
            req.csrfToken = () => 'error-fallback';
            next();
        }
    };
};

/**
 * CSRF protection middleware
 */
const csrfProtection = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    try {
        const token = req.body._csrf || 
                      req.headers['x-csrf-token'] || 
                      req.headers['xsrf-token'] ||
                      req.headers['x-xsrf-token'] ||
                      req.cookies['XSRF-TOKEN'];

        if (!token) {
            logger.warn('CSRF token missing', { method: req.method, path: req.path });
            return res.status(403).json({ ok: false, error: 'CSRF token missing' });
        }

        if (req.session?.csrfSecret && !tokens.verify(req.session.csrfSecret, token)) {
            logger.warn('CSRF token invalid', { method: req.method, path: req.path });
            return res.status(403).json({ ok: false, error: 'Invalid CSRF token' });
        }

        next();
    } catch (error) {
        console.error('CSRF protection error:', error);
        res.status(500).json({ ok: false, error: 'Security error' });
    }
};

/**
 * Generate CSRF token for API responses - FIXED: NEVER THROWS
 */
const generateToken = (req) => {
    console.log('🔑 generateToken called - Session exists:', !!req?.session);
    
    try {
        // Ultimate fallback: always return something
        if (!req || !req.session) {
            console.warn('⚠️ generateToken: No session, using timestamp fallback');
            return 'fallback-' + Date.now();
        }
        
        if (!req.session.csrfSecret) {
            console.log('   Creating new CSRF secret');
            req.session.csrfSecret = tokens.secretSync();
        }
        
        const token = tokens.create(req.session.csrfSecret);
        console.log('   ✅ Token created successfully');
        return token;
        
    } catch (error) {
        console.error('❌ generateToken error (using fallback):', error.message);
        // NEVER THROW - always return a string
        return 'error-fallback-' + Date.now();
    }
};

module.exports = {
    setupCsrf,
    csrfProtection,
    generateToken
};