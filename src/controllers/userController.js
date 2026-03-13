const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const KycProfile = require('../models/KycProfile');
const Beneficiary = require('../models/Beneficiary');
const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

class UserController {
    /**
     * Show user dashboard
     */
    async showDashboard(req, res) {
        try {
            const user = req.user;
            
            // Get wallet data
            const wallet = await Wallet.findOne({ user_id: user._id });
            
            // Get recent transactions
            const transactions = await Transaction.find({ user_id: user._id })
                .sort({ created_at: -1 })
                .limit(10);
            
            // Get today's total
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const todayTotal = await Transaction.aggregate([
                {
                    $match: {
                        user_id: user._id,
                        created_at: { $gte: today },
                        status: 'success'
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: '$amount' }
                    }
                }
            ]);

            // Get KYC status
            const kyc = await KycProfile.findOne({ user_id: user._id });

            // Check for payment messages from callback
            const queryParams = {
                payment_success: req.query.payment_success,
                payment_failed: req.query.payment_failed,
                payment_error: req.query.payment_error,
                tx_ref: req.query.tx_ref,
                amount: req.query.amount,
                balance: req.query.balance,
                status: req.query.status
            };

            // Check for debug mode flags
            const flwDebugMode = !process.env.FLW_PUBLIC_KEY || !process.env.FLW_SECRET_KEY;
            const vtpassDebugMode = !process.env.VTPASS_API_KEY || !process.env.VTPASS_SECRET_KEY;
            const debugMode = flwDebugMode || vtpassDebugMode;

            res.render('dashboard/user', {
                title: 'Dashboard',
                user,
                walletData: wallet || { balance: 0, status: 'active' },
                transactionsData: transactions,
                todayTotalData: todayTotal[0]?.total || 0,
                kycData: kyc,
                queryParams,
                flwDebugMode,
                vtpassDebugMode,
                debugMode,
                walletDisplayId: wallet ? `WLT-${String(wallet._id).slice(-6).toUpperCase()}` : 'WLT-000000',
                formatNaira: (amount) => `₦${Number(amount).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            });
        } catch (error) {
            logger.error('Show dashboard error:', error);
            req.flash('error', 'Failed to load dashboard');
            res.redirect('/auth');
        }
    }

    /**
     * Show profile page
     */
    async showProfile(req, res) {
        try {
            const user = req.user;
            
            // Get KYC status
            const kyc = await KycProfile.findOne({ user_id: user._id });

            res.render('dashboard/settings/index', {
                title: 'Profile & Security',
                layout: 'layouts/dashboard',
                user,
                kyc: kyc || { status: 'not_started' }
            });
        } catch (error) {
            logger.error('Show profile error:', error);
            req.flash('error', 'Failed to load profile');
            res.redirect('/dashboard/user');
        }
    }

    /**
     * Show transaction history
     */
    async showHistory(req, res) {
        try {
            const user = req.user;
            const page = parseInt(req.query.page) || 1;
            const limit = 20;
            const skip = (page - 1) * limit;
            
            // Build query based on filters
            const query = { user_id: user._id };
            
            if (req.query.type) query.type = req.query.type;
            if (req.query.status) query.status = req.query.status;
            
            if (req.query.from || req.query.to) {
                query.created_at = {};
                if (req.query.from) query.created_at.$gte = new Date(req.query.from);
                if (req.query.to) {
                    const toDate = new Date(req.query.to);
                    toDate.setHours(23, 59, 59, 999);
                    query.created_at.$lte = toDate;
                }
            }

            // Get transactions
            const transactions = await Transaction.find(query)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit);

            const total = await Transaction.countDocuments(query);

            // Prepare export data for CSV
            const exportData = transactions.map(t => ({
                d: t.created_at.toISOString().split('T')[0],
                t: t.type,
                info: t.details || `${t.provider} - ${t.account_target || ''}`,
                s: t.status,
                a: t.amount,
                ref: t.reference
            }));

            res.render('dashboard/history/index', {
                title: 'Transaction History',
                layout: 'layouts/dashboard',
                user,
                transactionsData: transactions,
                exportData,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                },
                queryParams: req.query,
                formatNaira: (amount) => `₦${Number(amount).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            });
        } catch (error) {
            logger.error('Show history error:', error);
            req.flash('error', 'Failed to load transaction history');
            res.redirect('/dashboard/user');
        }
    }

    /**
     * Update profile
     */
    async updateProfile(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.flash('error', errors.array()[0].msg);
            return res.redirect('/dashboard/settings');
        }

        const { name, email, phone, address } = req.body;

        try {
            const user = await User.findById(req.user._id);

            // Check if email is already taken by another user
            if (email && email !== user.email) {
                const existingUser = await User.findOne({ email: email.toLowerCase() });
                if (existingUser) {
                    req.flash('error', 'Email already in use');
                    return res.redirect('/dashboard/settings');
                }
            }

            // Update fields
            if (name) user.name = name;
            if (email) user.email = email.toLowerCase();
            if (phone) user.phone = phone;
            if (address) user.address = address;

            await user.save();

            // Update session
            req.session.user = user.getPublicProfile();

            req.flash('success', 'Profile updated successfully');
            res.redirect('/dashboard/settings');
        } catch (error) {
            logger.error('Update profile error:', error);
            req.flash('error', 'Failed to update profile');
            res.redirect('/dashboard/settings');
        }
    }

    /**
     * Change password
     */
    async changePassword(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.flash('error', errors.array()[0].msg);
            return res.redirect('/dashboard/settings');
        }

        const { current, new: newPassword, confirm } = req.body;

        // Check if new password matches confirm
        if (newPassword !== confirm) {
            req.flash('error', 'New passwords do not match');
            return res.redirect('/dashboard/settings');
        }

        // Check password length
        if (newPassword.length < 6) {
            req.flash('error', 'Password must be at least 6 characters');
            return res.redirect('/dashboard/settings');
        }

        try {
            const user = await User.findById(req.user._id).select('+password_hash');

            // Verify current password
            const isValid = await user.comparePassword(current);
            if (!isValid) {
                req.flash('error', 'Current password is incorrect');
                return res.redirect('/dashboard/settings');
            }

            // Update password
            user.password_hash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 10);
            await user.save();

            req.flash('success', 'Password changed successfully');
            res.redirect('/dashboard/settings');
        } catch (error) {
            logger.error('Change password error:', error);
            req.flash('error', 'Failed to change password');
            res.redirect('/dashboard/settings');
        }
    }

    /**
     * Upload profile photo
     */
    async uploadPhoto(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({
                    ok: false,
                    error: 'No file uploaded'
                });
            }

            const user = await User.findById(req.user._id);
            
            // Save photo path
            const photoPath = `/uploads/profile/${req.file.filename}`;
            user.photo = photoPath;
            await user.save();

            res.json({
                ok: true,
                message: 'Photo uploaded successfully',
                photo: photoPath
            });
        } catch (error) {
            logger.error('Upload photo error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to upload photo'
            });
        }
    }

    /**
     * Get user notifications
     */
    async getNotifications(req, res) {
        try {
            // This would fetch from a notifications collection
            // For now, return mock data
            const notifications = [];

            res.json({
                ok: true,
                notifications
            });
        } catch (error) {
            logger.error('Get notifications error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get notifications'
            });
        }
    }

    /**
     * Mark notification as read
     */
    async markNotificationRead(req, res) {
        const { id } = req.params;

        try {
            // Implement notification marking logic
            res.json({
                ok: true,
                message: 'Notification marked as read'
            });
        } catch (error) {
            logger.error('Mark notification error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to mark notification'
            });
        }
    }

    /**
     * Update notification preferences
     */
    async updateNotificationPreferences(req, res) {
        const { email, sms, push } = req.body;

        try {
            const user = await User.findById(req.user._id);
            
            user.preferences = {
                ...user.preferences,
                notifications: {
                    email: email !== undefined ? email : user.preferences?.notifications?.email,
                    sms: sms !== undefined ? sms : user.preferences?.notifications?.sms,
                    push: push !== undefined ? push : user.preferences?.notifications?.push
                }
            };

            await user.save();

            res.json({
                ok: true,
                message: 'Notification preferences updated',
                preferences: user.preferences
            });
        } catch (error) {
            logger.error('Update preferences error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to update preferences'
            });
        }
    }

    /**
     * Get user stats
     */
    async getUserStats(req, res) {
        try {
            const user = req.user;

            const [
                transactionStats,
                wallet,
                kyc
            ] = await Promise.all([
                Transaction.aggregate([
                    { $match: { user_id: user._id } },
                    {
                        $group: {
                            _id: '$status',
                            count: { $sum: 1 },
                            total: { $sum: '$amount' }
                        }
                    }
                ]),
                Wallet.findOne({ user_id: user._id }),
                KycProfile.findOne({ user_id: user._id })
            ]);

            res.json({
                ok: true,
                stats: {
                    transactions: transactionStats,
                    wallet: wallet ? {
                        balance: wallet.balance,
                        status: wallet.status,
                        tier: wallet.tier
                    } : null,
                    kyc: kyc ? {
                        status: kyc.status,
                        tier: kyc.tier
                    } : null,
                    member_since: user.created_at,
                    last_login: user.lastLogin
                }
            });
        } catch (error) {
            logger.error('Get user stats error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get user stats'
            });
        }
    }

    /**
     * Export user data (GDPR)
     */
    async exportUserData(req, res) {
        try {
            const user = req.user;

            const [transactions, wallet, kyc, beneficiaries] = await Promise.all([
                Transaction.find({ user_id: user._id }).lean(),
                Wallet.findOne({ user_id: user._id }).lean(),
                KycProfile.findOne({ user_id: user._id }).lean(),
                Beneficiary.find({ user_id: user._id }).lean()
            ]);

            const userData = {
                profile: user.getPublicProfile(),
                wallet,
                kyc,
                transactions,
                beneficiaries,
                export_date: new Date().toISOString()
            };

            res.json({
                ok: true,
                data: userData
            });
        } catch (error) {
            logger.error('Export user data error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to export user data'
            });
        }
    }

    /**
     * Delete account (GDPR)
     */
    async deleteAccount(req, res) {
        const { confirm, password } = req.body;

        if (!confirm || confirm !== 'DELETE') {
            return res.status(400).json({
                ok: false,
                error: 'Please type DELETE to confirm'
            });
        }

        try {
            const user = await User.findById(req.user._id).select('+password_hash');

            // Verify password
            const isValid = await user.comparePassword(password);
            if (!isValid) {
                return res.status(401).json({
                    ok: false,
                    error: 'Invalid password'
                });
            }

            // Soft delete or anonymize user data
            user.name = 'Deleted User';
            user.email = `deleted_${user._id}@deleted.mozaic.com`;
            user.phone = null;
            user.isActive = false;
            user.deleted_at = new Date();
            await user.save();

            // Destroy session
            req.session.destroy();

            res.json({
                ok: true,
                message: 'Account deleted successfully'
            });
        } catch (error) {
            logger.error('Delete account error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to delete account'
            });
        }
    }
}

module.exports = new UserController();