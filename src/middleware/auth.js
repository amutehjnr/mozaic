const User = require('../models/User');
const logger = require('../utils/logger');
console.log('✅ User model loaded in auth.js');
console.log('User.findById type:', typeof User.findById);

/**
 * Check if user is authenticated
 */
const isAuthenticated = async (req, res, next) => {
    try {
        if (!req.session.userId) {
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(401).json({
                    ok: false,
                    error: 'Authentication required'
                });
            }
            
            req.flash('error', 'Please login to continue');
            return res.redirect('/auth/login');
        }

        // Get fresh user data from database
        const user = await User.findById(req.session.userId).select('-password_hash');
        
        if (!user || !user.isActive) {
            req.session.destroy();
            
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(401).json({
                    ok: false,
                    error: 'Account not found or deactivated'
                });
            }
            
            req.flash('error', 'Account not found or deactivated');
            return res.redirect('/auth/login');
        }

        // Attach user to request
        req.user = user;
        
        // Update session with latest user data
        req.session.user = user.getPublicProfile();
        
        next();
    } catch (error) {
        logger.error('Auth middleware error:', error);
        
        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(500).json({
                ok: false,
                error: 'Authentication error'
            });
        }
        
        req.flash('error', 'Authentication error');
        res.redirect('/auth/login');
    }
};

/**
 * Check if user is guest (not authenticated) - ULTRA SAFE VERSION
 */
const isGuest = (req, res, next) => {
    try {
        // Ultra simple - just check if session exists and has userId
        if (req.session && req.session.userId) {
            // User is logged in, redirect to dashboard
            return res.redirect('/dashboard/user');
        }
        // Not logged in, proceed to login page
        next();
    } catch (error) {
        console.error('isGuest error:', error);
        // On any error, still let them see the login page
        next();
    }
};


/**
 * Check if user is admin
 */
const isAdmin = async (req, res, next) => {
    try {
        if (!req.user) {
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(401).json({
                    ok: false,
                    error: 'Authentication required'
                });
            }
            return res.redirect('/auth/login');
        }

        if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(403).json({
                    ok: false,
                    error: 'Admin access required'
                });
            }
            
            req.flash('error', 'Admin access required');
            return res.redirect('/dashboard/user');
        }

        next();
    } catch (error) {
        logger.error('Admin middleware error:', error);
        
        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(500).json({
                ok: false,
                error: 'Authorization error'
            });
        }
        
        req.flash('error', 'Authorization error');
        res.redirect('/dashboard/user');
    }
};

/**
 * Check if user is superadmin
 */
const isSuperAdmin = async (req, res, next) => {
    try {
        if (!req.user) {
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(401).json({
                    ok: false,
                    error: 'Authentication required'
                });
            }
            return res.redirect('/auth/login');
        }

        if (req.user.role !== 'superadmin') {
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(403).json({
                    ok: false,
                    error: 'Super admin access required'
                });
            }
            
            req.flash('error', 'Super admin access required');
            return res.redirect('/dashboard/user');
        }

        next();
    } catch (error) {
        logger.error('SuperAdmin middleware error:', error);
        
        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(500).json({
                ok: false,
                error: 'Authorization error'
            });
        }
        
        req.flash('error', 'Authorization error');
        res.redirect('/dashboard/user');
    }
};

/**
 * Optional authentication (doesn't require login, but attaches user if available)
 */
const optionalAuth = async (req, res, next) => {
    try {
        if (req.session.userId) {
            const user = await User.findById(req.session.userId).select('-password_hash');
            if (user && user.isActive) {
                req.user = user;
            }
        }
        next();
    } catch (error) {
        logger.error('Optional auth error:', error);
        next();
    }
};

/**
 * Check if user owns the resource
 */
const isOwner = (model) => async (req, res, next) => {
    try {
        const resourceId = req.params.id;
        const userId = req.user._id;

        const resource = await model.findById(resourceId);
        
        if (!resource) {
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(404).json({
                    ok: false,
                    error: 'Resource not found'
                });
            }
            
            req.flash('error', 'Resource not found');
            return res.redirect('back');
        }

        if (resource.user_id.toString() !== userId.toString() && req.user.role !== 'admin') {
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(403).json({
                    ok: false,
                    error: 'You do not have permission to access this resource'
                });
            }
            
            req.flash('error', 'You do not have permission to access this resource');
            return res.redirect('back');
        }

        req.resource = resource;
        next();
    } catch (error) {
        logger.error('Owner middleware error:', error);
        
        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(500).json({
                ok: false,
                error: 'Authorization error'
            });
        }
        
        req.flash('error', 'Authorization error');
        res.redirect('back');
    }
};

module.exports = {
    isAuthenticated,
    isGuest,
    isAdmin,
    isSuperAdmin,
    optionalAuth,
    isOwner
};