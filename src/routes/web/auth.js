const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../../controllers/authController');
const { csrfProtection } = require('../../middleware/csrf');
const { validate } = require('../../middleware/validation');
const { isAuthenticated, isGuest } = require('../../middleware/auth');
const rateLimiter = require('../../middleware/rateLimiter');
const { handleMultipart } = require('../../middleware/multer');

/**
 * Validation rules
 */
const registerValidation = [
    body('name').notEmpty().withMessage('Name is required').trim(),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('phone').optional().isMobilePhone('any').withMessage('Valid phone number is required')
];

const loginValidation = [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required')
];

const forgotValidation = [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail()
];

const resetValidation = [
    body('token').notEmpty().withMessage('Token is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('confirm').custom((value, { req }) => {
        if (value !== req.body.password) {
            throw new Error('Passwords do not match');
        }
        return true;
    })
];

/**
 * Guest routes (only accessible when not logged in)
 */
router.get('/login', isGuest, authController.showAuthPage);
router.get('/forgot', isGuest, authController.showForgotPage);
router.get('/reset', isGuest, authController.showResetPage);

/**
 * POST routes with CSRF protection
 */
router.post('/register', 
    handleMultipart,
    isGuest,
    rateLimiter.auth,
    csrfProtection,
    validate(registerValidation),
    authController.registerWeb
);

router.post('/login', 
    handleMultipart,
    rateLimiter.auth,
    csrfProtection,
    validate(loginValidation),
    authController.loginWeb
);

router.post('/forgot', 
    handleMultipart,
    isGuest,
    rateLimiter.auth,
    csrfProtection,
    validate(forgotValidation),
    authController.forgotWeb
);

router.post('/reset', 
    isGuest,
    rateLimiter.auth,
    csrfProtection,
    validate(resetValidation),
    authController.resetPasswordWeb
);

/**
 * Logout (accessible when authenticated)
 */
router.post('/logout', 
    isAuthenticated,
    csrfProtection,
    authController.logoutWeb
);

/**
 * Email verification (to be implemented)
 */
router.get('/verify-email', isAuthenticated, (req, res) => {
    res.render('auth/verify-email', {
        title: 'Verify Email',
    });
});

// Add this temporary test route right after your other routes
router.get('/test', (req, res) => {
    res.send('Auth test route working!');
});

router.get('/debug', (req, res) => {
    console.log('=== AUTH DEBUG ROUTE HIT ===');
    console.log('Time:', new Date().toISOString());
    console.log('Session exists:', !!req.session);
    console.log('Session ID:', req.session?.id);
    console.log('CSRF secret exists:', !!req.session?.csrfSecret);
    console.log('req.csrfToken exists:', typeof req.csrfToken === 'function');
    
    try {
        let csrfToken = 'not available';
        if (typeof req.csrfToken === 'function') {
            csrfToken = req.csrfToken();
            console.log('✅ CSRF token generated');
        } else {
            console.warn('⚠️ req.csrfToken is not a function');
        }
        
        const response = {
            message: 'Auth routes are working',
            session: req.session ? 'exists' : 'none',
            sessionId: req.session?.id,
            hasCsrfSecret: !!req.session?.csrfSecret,
            csrfToken: csrfToken
        };
        
        console.log('📤 Sending response');
        res.json(response);
        
    } catch (error) {
        console.error('❌ Auth Debug Error:');
        console.error('   Name:', error.name);
        console.error('   Message:', error.message);
        console.error('   Stack:', error.stack);
        
        res.status(500).json({ 
            error: 'Debug route error',
            details: error.message 
        });
    }
});

// Simple test route that doesn't use any middleware
router.get('/ping', (req, res) => {
    res.send('Auth route is alive');
});

router.get('/verify-email/:token', isAuthenticated, authController.verifyEmail);

module.exports = router;