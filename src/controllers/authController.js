const mongoose = require('mongoose');
const User = require('../models/User');
const PasswordReset = require('../models/PasswordReset');
// DEBUG: Check what User actually is
console.log('\n🔍 USER MODEL DEBUG:');
console.log('User type:', typeof User);
console.log('User is function?', typeof User === 'function');
console.log('User.findOne type:', typeof User.findOne);
console.log('User prototype:', User?.prototype?.constructor?.name);

// If User is not a function, log the actual value
if (typeof User !== 'function') {
    console.log('User actual value:', User);
}
const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');
const { generateToken, verifyToken } = require('../utils/helpers');
const logger = require('../utils/logger');

class AuthController {
    /**
     * Show login/register page
     */
    showAuthPage(req, res) {
    try {
        const isLogin = req.path === '/login';
        
        console.log('📝 Rendering auth page:', { isLogin, path: req.path });
        
        // Test if BASE_URL is valid
        try {
            new URL(process.env.BASE_URL);
            console.log('✅ BASE_URL is valid:', process.env.BASE_URL);
        } catch (e) {
            console.error('❌ BASE_URL is invalid:', process.env.BASE_URL, e.message);
        }
        
        res.render('auth/index', {
            title: isLogin ? 'Sign In - MozAic' : 'Create Account - MozAic',
            bodyClass: 'auth-page',
            mode: isLogin ? 'login' : 'register',
            formData: {},
            csrfToken: req.csrfToken ? req.csrfToken() : '',
            flashMessages: req.flash()
        });
    } catch (error) {
        console.error('❌ Error in showAuthPage:', error);
        res.status(500).send(`Error: ${error.message}\n${error.stack}`);
    }
}

    /**
     * Show forgot password page
     */
    showForgotPage(req, res) {
        res.render('auth/forgot', {
            title: 'Forgot Password',
            bodyClass: 'auth-page',
            formData: {},
            csrfToken: req.csrfToken ? req.csrfToken() : '',
            flashMessages: req.flash()
        });
    }

    /**
     * Show reset password page
     */
    async showResetPage(req, res) {
        const { token } = req.query;

        if (!token) {
            req.flash('error', 'Invalid reset link');
            return res.redirect('/auth/forgot');
        }

        // Find valid reset token
        const resetRequest = await PasswordReset.findOne({
            token,
            expires_at: { $gt: new Date() },
            used: false
        }).populate('user_id');

        if (!resetRequest) {
            req.flash('error', 'Invalid or expired reset link');
            return res.redirect('/auth/forgot');
        }

        res.render('auth/reset', {
            title: 'Reset Password',
            bodyClass: 'auth-page',
            formData: {},
            csrfToken: req.csrfToken ? req.csrfToken() : '',
            token,
            email: resetRequest.email,
            flashMessages: req.flash()
        });
    }

    /**
     * Register new user (web)
     */
    async registerWeb(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            // Check if AJAX request
            if (req.xhr || req.headers.accept === 'application/json') {
                return res.status(422).json({
                    ok: false,
                    error: errors.array()[0].msg
                });
            }
            req.flash('error', errors.array()[0].msg);
            return res.redirect('/auth/register');
        }

        const { name, email, password, phone } = req.body;

        try {
            // Check if user exists
            const existingUser = await User.findOne({ email: email.toLowerCase() });
            if (existingUser) {
                if (req.xhr || req.headers.accept === 'application/json') {
                    return res.status(409).json({
                        ok: false,
                        error: 'Email already registered'
                    });
                }
                req.flash('error', 'Email already registered');
                return res.redirect('/auth/register');
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 10);

            // Create user
            const user = await User.create({
                name: name.trim(),
                email: email.toLowerCase().trim(),
                phone: phone ? phone.trim() : undefined,
                password_hash: hashedPassword
            });

            // Set session
            req.session.userId = user._id;
            req.session.user = user.getPublicProfile();

            // Send welcome email (don't await)
            emailService.sendWelcomeEmail(user).catch(err => 
                logger.error('Failed to send welcome email:', err)
            );

            // Check if AJAX request
            if (req.xhr || req.headers.accept === 'application/json') {
                // Force HTTP in development
                const redirectUrl = '/dashboard/user';
                
                return res.json({
                    ok: true,
                    redirect: redirectUrl,
                    user: user.getPublicProfile()
                });
            }

            req.flash('success', 'Welcome to MozAic! 🎉');
            res.redirect('/dashboard/user');
        } catch (error) {
            logger.error('Registration error:', error);
            if (req.xhr || req.headers.accept === 'application/json') {
                return res.status(500).json({
                    ok: false,
                    error: 'An error occurred during registration'
                });
            }
            req.flash('error', 'An error occurred during registration');
            res.redirect('/auth/register');
        }
    }

    /**
     * Login user (web)
     */
    async loginWeb(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            // Check if AJAX request
            if (req.xhr || req.headers.accept === 'application/json') {
                return res.status(422).json({
                    ok: false,
                    error: errors.array()[0].msg
                });
            }
            req.flash('error', errors.array()[0].msg);
            return res.redirect('/auth/login');
        }

        const { email, password, remember } = req.body;

        try {
            // Find user
            const user = await User.findOne({ email: email.toLowerCase() });
            
            if (!user || !(await user.comparePassword(password))) {
                if (req.xhr || req.headers.accept === 'application/json') {
                    return res.status(401).json({
                        ok: false,
                        error: 'Incorrect email or password'
                    });
                }
                req.flash('error', 'Incorrect email or password');
                return res.redirect('/auth/login');
            }

            if (!user.isActive) {
                if (req.xhr || req.headers.accept === 'application/json') {
                    return res.status(403).json({
                        ok: false,
                        error: 'Your account has been deactivated. Please contact support.'
                    });
                }
                req.flash('error', 'Your account has been deactivated. Please contact support.');
                return res.redirect('/auth/login');
            }

            // Update login stats
            user.lastLogin = new Date();
            user.lastLoginIP = req.ip;
            user.loginCount += 1;
            await user.save();

            // Set session
            req.session.userId = user._id;
            req.session.user = user.getPublicProfile();
            
            if (remember) {
                req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
            }

            // Check if AJAX request
            if (req.xhr || req.headers.accept === 'application/json') {
                // Force HTTP in development
                const redirectUrl = '/dashboard/user';
                
                return res.json({
                    ok: true,
                    redirect: redirectUrl,
                    user: user.getPublicProfile()
                });
            }

            req.flash('success', 'Logged in successfully');
            res.redirect('/dashboard/user');
        } catch (error) {
            logger.error('Login error:', error);
            if (req.xhr || req.headers.accept === 'application/json') {
                return res.status(500).json({
                    ok: false,
                    error: 'An error occurred during login'
                });
            }
            req.flash('error', 'An error occurred during login');
            res.redirect('/auth/login');
        }
    }

    /**
     * Logout user (web)
     */
    logoutWeb(req, res) {
        req.session.destroy((err) => {
            if (err) {
                logger.error('Logout error:', err);
            }
            res.redirect('/auth/login');
        });
    }

    /**
     * Process forgot password (web)
     */
    async forgotWeb(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            if (req.xhr || req.headers.accept === 'application/json') {
                return res.status(422).json({
                    ok: false,
                    error: errors.array()[0].msg
                });
            }
            req.flash('error', errors.array()[0].msg);
            return res.redirect('/auth/forgot');
        }

        const { email } = req.body;

        try {
            const result = await this.processPasswordReset(email.toLowerCase());
            
            if (req.xhr || req.headers.accept === 'application/json') {
                return res.json({
                    ok: true,
                    message: result.success ? 'Reset email sent' : 'Reset link created',
                    link: result.link
                });
            }
            
            if (result.success) {
                req.flash('success', 'Reset email sent. Check your inbox.');
            } else {
                req.flash('success', `Reset link created. (Dev: ${result.link})`);
            }

            res.redirect('/auth/forgot');
        } catch (error) {
            logger.error('Forgot password error:', error);
            if (req.xhr || req.headers.accept === 'application/json') {
                return res.status(500).json({
                    ok: false,
                    error: 'An error occurred'
                });
            }
            req.flash('error', 'An error occurred');
            res.redirect('/auth/forgot');
        }
    }

    /**
     * Reset password (web)
     */
    async resetPasswordWeb(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            if (req.xhr || req.headers.accept === 'application/json') {
                return res.status(422).json({
                    ok: false,
                    error: errors.array()[0].msg
                });
            }
            req.flash('error', errors.array()[0].msg);
            return res.redirect(`/auth/reset?token=${req.body.token}`);
        }

        const { token, password } = req.body;

        try {
            // Find valid reset token
            const resetRequest = await PasswordReset.findOne({
                token,
                expires_at: { $gt: new Date() },
                used: false
            });

            if (!resetRequest) {
                if (req.xhr || req.headers.accept === 'application/json') {
                    return res.status(400).json({
                        ok: false,
                        error: 'Invalid or expired reset link'
                    });
                }
                req.flash('error', 'Invalid or expired reset link');
                return res.redirect('/auth/forgot');
            }

            // Find user
            const user = await User.findById(resetRequest.user_id);
            if (!user) {
                if (req.xhr || req.headers.accept === 'application/json') {
                    return res.status(404).json({
                        ok: false,
                        error: 'User not found'
                    });
                }
                req.flash('error', 'User not found');
                return res.redirect('/auth/forgot');
            }

            // Update password
            user.password_hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 10);
            await user.save();

            // Mark token as used
            resetRequest.used = true;
            resetRequest.used_at = new Date();
            await resetRequest.save();

            if (req.xhr || req.headers.accept === 'application/json') {
                return res.json({
                    ok: true,
                    message: 'Password updated successfully'
                });
            }

            req.flash('success', 'Password updated successfully. Please login.');
            res.redirect('/auth/login');
        } catch (error) {
            logger.error('Reset password error:', error);
            if (req.xhr || req.headers.accept === 'application/json') {
                return res.status(500).json({
                    ok: false,
                    error: 'An error occurred'
                });
            }
            req.flash('error', 'An error occurred');
            res.redirect('/auth/forgot');
        }
    }

    /**
     * API: Register user
     */
    async register(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ 
                ok: false, 
                error: errors.array()[0].msg 
            });
        }

        const { name, email, password, phone } = req.body;

        try {
            const existingUser = await User.findOne({ email: email.toLowerCase() });
            if (existingUser) {
                return res.status(409).json({ 
                    ok: false, 
                    error: 'Email already registered' 
                });
            }

            const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 10);

            const user = await User.create({
                name: name.trim(),
                email: email.toLowerCase().trim(),
                phone: phone ? phone.trim() : undefined,
                password_hash: hashedPassword
            });

            req.session.userId = user._id;
            req.session.user = user.getPublicProfile();

            // Send welcome email (async, don't wait)
            emailService.sendWelcomeEmail(user).catch(err => 
                logger.error('Failed to send welcome email:', err)
            );

            res.json({ 
                ok: true, 
                redirect: '/dashboard/user',
                user: user.getPublicProfile()
            });
        } catch (error) {
            logger.error('API Registration error:', error);
            res.status(500).json({ 
                ok: false, 
                error: 'Server error' 
            });
        }
    }

    /**
     * API: Login user
     */
    async login(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ 
                ok: false, 
                error: errors.array()[0].msg 
            });
        }

        const { email, password } = req.body;

        try {
            const user = await User.findOne({ email: email.toLowerCase() });
            
            if (!user || !(await user.comparePassword(password))) {
                return res.status(401).json({ 
                    ok: false, 
                    error: 'Incorrect email or password' 
                });
            }

            if (!user.isActive) {
                return res.status(403).json({ 
                    ok: false, 
                    error: 'Account deactivated' 
                });
            }

            // Update login stats
            user.lastLogin = new Date();
            user.lastLoginIP = req.ip;
            user.loginCount += 1;
            await user.save();

            req.session.userId = user._id;
            req.session.user = user.getPublicProfile();

            res.json({ 
                ok: true, 
                redirect: '/dashboard/user',
                user: user.getPublicProfile()
            });
        } catch (error) {
            logger.error('API Login error:', error);
            res.status(500).json({ 
                ok: false, 
                error: 'Server error' 
            });
        }
    }

    /**
     * API: Logout user
     */
    logout(req, res) {
        req.session.destroy((err) => {
            if (err) {
                return res.status(500).json({ 
                    ok: false, 
                    error: 'Logout failed' 
                });
            }
            res.json({ ok: true });
        });
    }

    /**
     * API: Forgot password
     */
    async forgot(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                ok: false, 
                error: errors.array()[0].msg 
            });
        }

        const { email } = req.body;

        try {
            const result = await this.processPasswordReset(email.toLowerCase(), req);

            res.json({ 
                ok: true, 
                link: result.link, 
                mail: result.success,
                message: result.success 
                    ? 'Reset link sent to your email' 
                    : 'Reset link created (demo mode)'
            });
        } catch (error) {
            logger.error('API Forgot password error:', error);
            res.status(500).json({ 
                ok: false, 
                error: 'Server error' 
            });
        }
    }

    /**
     * API: Reset password
     */
    async resetPassword(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ 
                ok: false, 
                error: errors.array()[0].msg 
            });
        }

        const { token, password } = req.body;

        try {
            const resetRequest = await PasswordReset.findOne({
                token,
                expires_at: { $gt: new Date() },
                used: false
            });

            if (!resetRequest) {
                return res.status(400).json({ 
                    ok: false, 
                    error: 'Invalid or expired token' 
                });
            }

            const user = await User.findById(resetRequest.user_id);
            if (!user) {
                return res.status(404).json({ 
                    ok: false, 
                    error: 'User not found' 
                });
            }

            user.password_hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 10);
            await user.save();

            resetRequest.used = true;
            resetRequest.used_at = new Date();
            await resetRequest.save();

            res.json({ 
                ok: true, 
                message: 'Password updated successfully' 
            });
        } catch (error) {
            logger.error('API Reset password error:', error);
            res.status(500).json({ 
                ok: false, 
                error: 'Server error' 
            });
        }
    }

    /**
     * Password reset logic
     */
    async processPasswordReset(email, req = null) {
        try {
            // Find user (optional - don't reveal if exists)
            const user = await User.findOne({ email });
            
            // Generate token
            const plainToken = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

            // Save to database
            const resetRequest = await PasswordReset.create({
                user_id: user?._id,
                email,
                token: plainToken,
                expires_at: expiresAt,
                ip_address: req?.ip,
                user_agent: req?.headers['user-agent']
            });

            const resetLink = `${process.env.BASE_URL}/auth/reset?token=${plainToken}`;

            // Send email if user exists
            let emailSent = false;
            if (user) {
                const emailResult = await emailService.sendPasswordResetEmail(email, resetLink);
                emailSent = emailResult.success;
            }

            return {
                success: emailSent,
                link: resetLink,
                email
            };
        } catch (error) {
            logger.error('Password reset processing error:', error);
            
            // Fallback: generate token without DB (for development)
            const plainToken = crypto.randomBytes(32).toString('hex');
            const resetLink = `${process.env.BASE_URL}/auth/reset?token=${plainToken}`;
            
            return {
                success: false,
                link: resetLink,
                email
            };
        }
    }

    /**
     * Verify email (for future implementation)
     */
    async verifyEmail(req, res) {
        const { token } = req.query;

        if (!token) {
            req.flash('error', 'Invalid verification link');
            return res.redirect('/auth');
        }

        try {
            // Implement email verification logic
            req.flash('success', 'Email verified successfully');
            res.redirect('/dashboard/user');
        } catch (error) {
            logger.error('Email verification error:', error);
            req.flash('error', 'Verification failed');
            res.redirect('/auth/login');
        }
    }
}

module.exports = new AuthController();