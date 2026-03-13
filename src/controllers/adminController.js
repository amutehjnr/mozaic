const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const KycProfile = require('../models/KycProfile');
const Referral = require('../models/Referral');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

class AdminController {
    /**
     * Admin authentication middleware
     */
    async isAdmin(req, res, next) {
        if (!req.user || req.user.role !== 'admin') {
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(403).json({
                    ok: false,
                    error: 'Access denied. Admin only.'
                });
            }
            req.flash('error', 'Access denied');
            return res.redirect('/dashboard/user');
        }
        next();
    }

    /**
     * Show admin dashboard
     */
    async showDashboard(req, res) {
        try {
            // Get stats
            const [
                totalUsers,
                activeUsers,
                pendingKyc,
                totalTransactions,
                totalVolume,
                systemBalance
            ] = await Promise.all([
                User.countDocuments(),
                User.countDocuments({ 
                    lastLogin: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                }),
                KycProfile.countDocuments({ status: 'pending' }),
                Transaction.countDocuments(),
                Transaction.aggregate([
                    { $match: { status: 'success' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]),
                Wallet.aggregate([
                    { $group: { _id: null, total: { $sum: '$balance' } } }
                ])
            ]);

            // Get recent transactions
            const recentTransactions = await Transaction.find()
                .populate('user_id', 'name email')
                .sort({ created_at: -1 })
                .limit(10);

            // Get recent users
            const recentUsers = await User.find()
                .sort({ created_at: -1 })
                .limit(10)
                .select('-password_hash');

            res.render('admin/dashboard', {
                title: 'Admin Dashboard',
                layout: 'layouts/admin',
                stats: {
                    totalUsers,
                    activeUsers,
                    pendingKyc,
                    totalTransactions,
                    totalVolume: totalVolume[0]?.total || 0,
                    systemBalance: systemBalance[0]?.total || 0
                },
                recentTransactions,
                recentUsers
            });
        } catch (error) {
            logger.error('Admin dashboard error:', error);
            req.flash('error', 'Failed to load dashboard');
            res.redirect('/dashboard/user');
        }
    }

    /**
     * Get system stats
     */
    async getStats(req, res) {
        try {
            const { period = 'day' } = req.query;
            
            let dateFilter = {};
            const now = new Date();

            switch (period) {
                case 'day':
                    dateFilter = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
                    break;
                case 'week':
                    dateFilter = { $gte: new Date(now.setDate(now.getDate() - 7)) };
                    break;
                case 'month':
                    dateFilter = { $gte: new Date(now.setMonth(now.getMonth() - 1)) };
                    break;
                case 'year':
                    dateFilter = { $gte: new Date(now.setFullYear(now.getFullYear() - 1)) };
                    break;
            }

            const [
                userStats,
                transactionStats,
                kycStats,
                revenueStats
            ] = await Promise.all([
                // User stats
                User.aggregate([
                    {
                        $facet: {
                            total: [{ $count: 'count' }],
                            new: [
                                { $match: { created_at: dateFilter } },
                                { $count: 'count' }
                            ],
                            byRole: [
                                { $group: { _id: '$role', count: { $sum: 1 } } }
                            ]
                        }
                    }
                ]),
                // Transaction stats
                Transaction.aggregate([
                    {
                        $facet: {
                            total: [{ $count: 'count' }],
                            volume: [
                                { $match: { status: 'success' } },
                                { $group: { _id: null, total: { $sum: '$amount' } } }
                            ],
                            byStatus: [
                                { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amount' } } }
                            ],
                            byProvider: [
                                { $group: { _id: '$provider', count: { $sum: 1 }, total: { $sum: '$amount' } } }
                            ]
                        }
                    }
                ]),
                // KYC stats
                KycProfile.aggregate([
                    { $group: { _id: '$status', count: { $sum: 1 } } }
                ]),
                // Revenue by day
                Transaction.aggregate([
                    {
                        $match: {
                            status: 'success',
                            created_at: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                        }
                    },
                    {
                        $group: {
                            _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
                            count: { $sum: 1 },
                            volume: { $sum: '$amount' }
                        }
                    },
                    { $sort: { _id: 1 } }
                ])
            ]);

            res.json({
                ok: true,
                stats: {
                    users: {
                        total: userStats[0]?.total[0]?.count || 0,
                        new: userStats[0]?.new[0]?.count || 0,
                        byRole: userStats[0]?.byRole || []
                    },
                    transactions: {
                        total: transactionStats[0]?.total[0]?.count || 0,
                        volume: transactionStats[0]?.volume[0]?.total || 0,
                        byStatus: transactionStats[0]?.byStatus || [],
                        byProvider: transactionStats[0]?.byProvider || []
                    },
                    kyc: kycStats,
                    revenue: revenueStats
                }
            });
        } catch (error) {
            logger.error('Get stats error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get stats'
            });
        }
    }

    /**
     * Get all users with filters
     */
    async getUsers(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const skip = (page - 1) * limit;
            const { search, role, status, from, to } = req.query;

            // Build query
            const query = {};
            
            if (search) {
                query.$or = [
                    { name: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } },
                    { phone: { $regex: search, $options: 'i' } }
                ];
            }
            
            if (role) query.role = role;
            if (status === 'active') query.isActive = true;
            if (status === 'inactive') query.isActive = false;
            
            if (from || to) {
                query.created_at = {};
                if (from) query.created_at.$gte = new Date(from);
                if (to) query.created_at.$lte = new Date(to);
            }

            // Get users
            const users = await User.find(query)
                .select('-password_hash')
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit);

            const total = await User.countDocuments(query);

            // Get additional data for each user
            const enrichedUsers = await Promise.all(users.map(async (user) => {
                const [wallet, kyc, transactionCount] = await Promise.all([
                    Wallet.findOne({ user_id: user._id }),
                    KycProfile.findOne({ user_id: user._id }),
                    Transaction.countDocuments({ user_id: user._id })
                ]);

                return {
                    ...user.toObject(),
                    wallet: wallet ? {
                        balance: wallet.balance,
                        status: wallet.status,
                        tier: wallet.tier
                    } : null,
                    kyc: kyc ? {
                        status: kyc.status,
                        tier: kyc.tier
                    } : null,
                    transactionCount
                };
            }));

            res.json({
                ok: true,
                users: enrichedUsers,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            logger.error('Get users error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get users'
            });
        }
    }

    /**
     * Get single user details
     */
    async getUserDetails(req, res) {
        try {
            const { id } = req.params;

            const user = await User.findById(id).select('-password_hash');
            
            if (!user) {
                return res.status(404).json({
                    ok: false,
                    error: 'User not found'
                });
            }

            // Get related data
            const [wallet, kyc, transactions, referrals] = await Promise.all([
                Wallet.findOne({ user_id: user._id }),
                KycProfile.findOne({ user_id: user._id }),
                Transaction.find({ user_id: user._id }).sort({ created_at: -1 }).limit(50),
                Referral.find({ referrer_user_id: user._id }).populate('referred_user_id', 'name email')
            ]);

            res.json({
                ok: true,
                user: {
                    ...user.toObject(),
                    wallet,
                    kyc,
                    transactions,
                    referrals
                }
            });
        } catch (error) {
            logger.error('Get user details error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get user details'
            });
        }
    }

    /**
     * Update user
     */
    async updateUser(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                ok: false,
                error: errors.array()[0].msg
            });
        }

        const { id } = req.params;
        const { name, email, phone, role, isActive, preferences } = req.body;

        try {
            const user = await User.findById(id);
            
            if (!user) {
                return res.status(404).json({
                    ok: false,
                    error: 'User not found'
                });
            }

            // Update fields
            if (name) user.name = name;
            if (email) user.email = email;
            if (phone) user.phone = phone;
            if (role) user.role = role;
            if (isActive !== undefined) user.isActive = isActive;
            if (preferences) user.preferences = { ...user.preferences, ...preferences };

            await user.save();

            res.json({
                ok: true,
                message: 'User updated successfully',
                user: user.getPublicProfile()
            });
        } catch (error) {
            logger.error('Update user error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to update user'
            });
        }
    }

    /**
     * Get all transactions
     */
    async getTransactions(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const skip = (page - 1) * limit;
            const { type, status, provider, from, to, userId } = req.query;

            // Build query
            const query = {};
            
            if (type) query.type = type;
            if (status) query.status = status;
            if (provider) query.provider = provider;
            if (userId) query.user_id = userId;
            
            if (from || to) {
                query.created_at = {};
                if (from) query.created_at.$gte = new Date(from);
                if (to) query.created_at.$lte = new Date(to);
            }

            const transactions = await Transaction.find(query)
                .populate('user_id', 'name email')
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit);

            const total = await Transaction.countDocuments(query);

            // Get summary stats
            const summary = await Transaction.aggregate([
                { $match: query },
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: '$amount' },
                        avgAmount: { $avg: '$amount' },
                        successCount: {
                            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
                        },
                        failedCount: {
                            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                        }
                    }
                }
            ]);

            res.json({
                ok: true,
                transactions,
                summary: summary[0] || { totalAmount: 0, avgAmount: 0, successCount: 0, failedCount: 0 },
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            logger.error('Get transactions error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get transactions'
            });
        }
    }

    /**
     * Manual wallet adjustment
     */
    async adjustWallet(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                ok: false,
                error: errors.array()[0].msg
            });
        }

        const { userId, amount, type, reason } = req.body;
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            const wallet = await Wallet.findOne({ user_id: userId }).session(session);
            
            if (!wallet) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({
                    ok: false,
                    error: 'Wallet not found'
                });
            }

            // Apply adjustment
            if (type === 'credit') {
                await wallet.credit(amount, session);
            } else if (type === 'debit') {
                await wallet.debit(amount, session);
            } else {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    ok: false,
                    error: 'Invalid adjustment type'
                });
            }

            // Create transaction record
            const transaction = await Transaction.create([{
                user_id: userId,
                wallet_id: wallet._id,
                type,
                provider: 'system',
                amount,
                currency: 'NGN',
                status: 'success',
                reference: Transaction.generateReference('admin'),
                details: `Manual ${type} by admin: ${reason}`,
                metadata: {
                    admin_id: req.user._id,
                    reason,
                    original_balance: type === 'credit' ? wallet.balance - amount : wallet.balance + amount,
                    new_balance: wallet.balance
                }
            }], { session });

            await session.commitTransaction();
            session.endSession();

            res.json({
                ok: true,
                message: `Wallet ${type}ed successfully`,
                transaction: transaction[0]
            });
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            
            logger.error('Adjust wallet error:', error);
            res.status(500).json({
                ok: false,
                error: error.message || 'Failed to adjust wallet'
            });
        }
    }

    /**
     * Get system logs
     */
    async getLogs(req, res) {
        try {
            const { level, limit = 100 } = req.query;
            
            // This would integrate with your logging system
            // For now, return mock data
            const logs = [];

            res.json({
                ok: true,
                logs
            });
        } catch (error) {
            logger.error('Get logs error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get logs'
            });
        }
    }

    /**
     * Get system health
     */
    async getHealth(req, res) {
        try {
            // Check database connection
            const dbStatus = mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy';
            
            // Check external services
            const services = {
                database: dbStatus,
                flutterwave: process.env.FLW_PUBLIC_KEY ? 'configured' : 'missing',
                vtpass: process.env.VTPASS_API_KEY ? 'configured' : 'missing',
                email: process.env.EMAIL_HOST ? 'configured' : 'missing'
            };

            // Get system metrics
            const metrics = {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cpu: process.cpuUsage()
            };

            res.json({
                ok: true,
                status: Object.values(services).every(s => s === 'healthy' || s === 'configured') ? 'healthy' : 'degraded',
                services,
                metrics,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('Get health error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get health status'
            });
        }
    }
}

module.exports = new AdminController();