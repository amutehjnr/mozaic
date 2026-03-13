const Referral = require('../models/Referral');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

class ReferralController {
    /**
     * Show referrals page
     */
    async showReferralsPage(req, res) {
        try {
            const user = req.user;
            
            // Get referrals
            const referrals = await Referral.find({ 
                referrer_user_id: user._id 
            }).sort({ created_at: -1 });

            // Get total clicks
            const totalClicks = referrals.reduce((sum, r) => sum + (r.clicks || 0), 0);

            // Calculate total rewards
            let totalRewards = 0;
            referrals.forEach(r => {
                if (r.reward_paid) {
                    totalRewards += r.reward_amount || 0;
                }
            });

            // Count active referrals (those who have transacted)
            const activeCount = referrals.filter(r => r.status === 'active').length;

            // Calculate conversion rate
            const conversion = totalClicks ? Math.round((referrals.length / totalClicks) * 100) : 0;

            // Determine tier
            const tier = this.calculateTier(activeCount);
            const progress = this.calculateTierProgress(activeCount, tier);

            // Prepare data for template
            const exportData = referrals.map(r => ({
                name: r.referred_user_id?.name || r.referred_email || 'Pending',
                joined: r.created_at.toISOString().split('T')[0],
                status: this.getStatusLabel(r.status),
                reward: r.reward_amount || 0
            }));

            res.render('dashboard/referrals/index', {
                title: 'Referrals & Rewards',
                layout: 'layouts/dashboard',
                user,
                referrals: exportData,
                totalClicks,
                totalRewards,
                activeCount,
                conversion,
                tier,
                progress,
                refLink: `${process.env.BASE_URL}/r/${user.referral_code}`
            });
        } catch (error) {
            logger.error('Show referrals page error:', error);
            req.flash('error', 'Failed to load referrals page');
            res.redirect('/dashboard/user');
        }
    }

    /**
     * Get referral stats
     */
    async getReferralStats(req, res) {
        try {
            const user = req.user;
            
            // Get referrals
            const referrals = await Referral.find({ referrer_user_id: user._id });

            // Calculate stats
            const totalClicks = referrals.reduce((sum, r) => sum + (r.clicks || 0), 0);
            const totalSignups = referrals.filter(r => r.status !== 'pending').length;
            const totalActive = referrals.filter(r => r.status === 'active').length;
            const totalConverted = referrals.filter(r => r.status === 'converted').length;
            
            let totalEarned = 0;
            let pendingRewards = 0;
            
            referrals.forEach(r => {
                if (r.reward_paid) {
                    totalEarned += r.reward_amount || 0;
                } else if (r.status === 'active' || r.status === 'converted') {
                    pendingRewards += r.reward_amount || 0;
                }
            });

            // Calculate conversion rate
            const clickConversion = totalClicks ? Math.round((totalSignups / totalClicks) * 100) : 0;
            const signupConversion = totalSignups ? Math.round((totalActive / totalSignups) * 100) : 0;

            res.json({
                ok: true,
                stats: {
                    clicks: totalClicks,
                    signups: totalSignups,
                    active: totalActive,
                    converted: totalConverted,
                    earned: totalEarned,
                    pending_rewards: pendingRewards,
                    click_conversion: clickConversion,
                    signup_conversion: signupConversion
                },
                tier: this.calculateTier(totalActive)
            });
        } catch (error) {
            logger.error('Get referral stats error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get referral stats'
            });
        }
    }

    /**
     * Get referral list
     */
    async getReferrals(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const skip = (page - 1) * limit;
            const { status } = req.query;

            // Build query
            const query = { referrer_user_id: req.user._id };
            if (status) query.status = status;

            // Get referrals
            const referrals = await Referral.find(query)
                .populate('referred_user_id', 'name email phone created_at')
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit);

            const total = await Referral.countDocuments(query);

            res.json({
                ok: true,
                referrals: referrals.map(r => ({
                    id: r._id,
                    user: r.referred_user_id ? {
                        id: r.referred_user_id._id,
                        name: r.referred_user_id.name,
                        email: r.referred_user_id.email,
                        phone: r.referred_user_id.phone
                    } : null,
                    email: r.referred_email,
                    phone: r.referred_phone,
                    status: r.status,
                    status_label: this.getStatusLabel(r.status),
                    clicks: r.clicks,
                    reward: r.reward_amount,
                    reward_paid: r.reward_paid,
                    conversion_amount: r.conversion_amount,
                    conversion_date: r.conversion_date,
                    created_at: r.created_at
                })),
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            logger.error('Get referrals error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get referrals'
            });
        }
    }

    /**
     * Track referral click
     */
    async trackClick(req, res) {
        const { code } = req.params;

        try {
            // Find referrer by referral code
            const referrer = await User.findOne({ referral_code: code.toUpperCase() });

            if (!referrer) {
                return res.redirect('/auth');
            }

            // Create or update referral record
            let referral = await Referral.findOne({
                referral_code: code.toUpperCase(),
                referred_email: null,
                referred_user_id: null
            });

            if (!referral) {
                referral = new Referral({
                    referrer_user_id: referrer._id,
                    referral_code: code.toUpperCase(),
                    status: 'clicked'
                });
            }

            // Track click
            await referral.trackClick(req.ip, req.headers['user-agent']);

            // Set cookie to track this referral
            res.cookie('referral_code', code, {
                maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production'
            });

            // Redirect to signup page
            res.redirect('/auth?ref=' + code);
        } catch (error) {
            logger.error('Track click error:', error);
            res.redirect('/auth');
        }
    }

    /**
     * Process referral after signup
     */
    async processReferralAfterSignup(userId, referralCode, ip, userAgent) {
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            // Find referrer
            const referrer = await User.findOne({ referral_code: referralCode }).session(session);

            if (!referrer) {
                await session.abortTransaction();
                session.endSession();
                return;
            }

            // Check if this user was already referred
            const existingReferral = await Referral.findOne({
                referred_user_id: userId
            }).session(session);

            if (existingReferral) {
                await session.abortTransaction();
                session.endSession();
                return;
            }

            // Create referral record
            const referral = await Referral.create([{
                referrer_user_id: referrer._id,
                referred_user_id: userId,
                referral_code: referralCode,
                status: 'signed_up',
                ip_address: ip,
                user_agent: userAgent,
                metadata: {
                    signed_up_at: new Date()
                }
            }], { session });

            await session.commitTransaction();
            session.endSession();

            logger.info(`Referral processed: ${referralCode} -> ${userId}`);
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            logger.error('Process referral after signup error:', error);
        }
    }

    /**
     * Check and process referral rewards after transaction
     */
    async checkAndProcessReward(userId, transactionAmount) {
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            // Find if user was referred
            const referral = await Referral.findOne({
                referred_user_id: userId,
                status: { $in: ['signed_up', 'active'] }
            }).session(session).populate('referrer_user_id');

            if (!referral) {
                await session.abortTransaction();
                session.endSession();
                return;
            }

            // Calculate reward based on tier and transaction amount
            const rewardAmount = this.calculateReward(referral.referrer_user_id, transactionAmount);

            // Update referral status
            referral.status = 'active';
            referral.conversion_amount = transactionAmount;
            referral.conversion_date = new Date();
            
            // Store reward (to be paid later or immediately based on rules)
            if (rewardAmount > 0) {
                referral.reward_amount = rewardAmount;
                
                // Optionally pay immediately
                if (this.shouldPayImmediately(transactionAmount)) {
                    await this.payReferralReward(referral, session);
                }
            }

            await referral.save({ session });

            await session.commitTransaction();
            session.endSession();

            // Send notification to referrer
            if (referral.referrer_user_id) {
                emailService.sendReferralBonusEmail(
                    referral.referrer_user_id,
                    rewardAmount,
                    { name: userId.name || 'Someone' }
                ).catch(err => logger.error('Failed to send referral email:', err));
            }
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            logger.error('Check and process reward error:', error);
        }
    }

    /**
     * Pay referral reward
     */
    async payReferralReward(referral, session) {
        try {
            // Get referrer's wallet
            const wallet = await Wallet.findOne({ 
                user_id: referral.referrer_user_id 
            }).session(session);

            if (!wallet) return;

            // Credit wallet
            await wallet.credit(referral.reward_amount, session);

            // Create transaction record
            await Transaction.create([{
                user_id: referral.referrer_user_id,
                wallet_id: wallet._id,
                type: 'bonus',
                provider: 'referral',
                amount: referral.reward_amount,
                currency: 'NGN',
                status: 'success',
                reference: Transaction.generateReference('referral'),
                details: `Referral bonus for user #${referral.referred_user_id}`,
                metadata: {
                    referral_id: referral._id,
                    referred_user_id: referral.referred_user_id
                }
            }], { session });

            // Mark as paid
            referral.reward_paid = true;
            referral.reward_paid_at = new Date();

            logger.info(`Referral reward paid: ₦${referral.reward_amount} to user ${referral.referrer_user_id}`);
        } catch (error) {
            logger.error('Pay referral reward error:', error);
            throw error;
        }
    }

    /**
     * Calculate tier based on active referrals
     */
    calculateTier(activeCount) {
        if (activeCount >= 100) return 'Platinum';
        if (activeCount >= 30) return 'Gold';
        if (activeCount >= 10) return 'Silver';
        return 'Bronze';
    }

    /**
     * Calculate tier progress percentage
     */
    calculateTierProgress(activeCount, currentTier) {
        const tiers = {
            'Bronze': { min: 0, max: 9, next: 'Silver', nextThreshold: 10 },
            'Silver': { min: 10, max: 29, next: 'Gold', nextThreshold: 30 },
            'Gold': { min: 30, max: 99, next: 'Platinum', nextThreshold: 100 },
            'Platinum': { min: 100, max: null, next: null, nextThreshold: null }
        };

        const tier = tiers[currentTier];
        
        if (!tier || !tier.next) return 100;
        
        const progress = ((activeCount - tier.min) / (tier.nextThreshold - tier.min)) * 100;
        return Math.min(100, Math.max(0, Math.round(progress)));
    }

    /**
     * Calculate reward amount based on tier and transaction
     */
    calculateReward(referrer, transactionAmount) {
        // Get referrer's active count to determine tier
        // This would need to query their active referrals
        // For now, use base reward amount from env
        const baseReward = parseFloat(process.env.REFERRAL_BONUS_AMOUNT) || 100;
        
        // Tier multipliers
        const multipliers = {
            'Bronze': 1,
            'Silver': 1.5,
            'Gold': 2,
            'Platinum': 3
        };

        // Determine tier (simplified - would need actual active count)
        const tier = 'Bronze'; // Placeholder
        
        return baseReward * (multipliers[tier] || 1);
    }

    /**
     * Determine if reward should be paid immediately
     */
    shouldPayImmediately(transactionAmount) {
        const minAmount = parseFloat(process.env.REFERRAL_MIN_TRANSACTION) || 1000;
        return transactionAmount >= minAmount;
    }

    /**
     * Get human-readable status label
     */
    getStatusLabel(status) {
        const labels = {
            'pending': 'Pending',
            'clicked': 'Clicked',
            'signed_up': 'Signed Up',
            'active': 'Active',
            'converted': 'Converted',
            'expired': 'Expired'
        };
        return labels[status] || status;
    }

    /**
     * Get referral link
     */
    getReferralLink(req, res) {
        try {
            const link = `${process.env.BASE_URL}/r/${req.user.referral_code}`;
            
            res.json({
                ok: true,
                link,
                code: req.user.referral_code
            });
        } catch (error) {
            logger.error('Get referral link error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get referral link'
            });
        }
    }

    /**
     * Export referrals CSV
     */
    async exportReferrals(req, res) {
        try {
            const referrals = await Referral.find({ 
                referrer_user_id: req.user._id 
            }).populate('referred_user_id', 'name email phone');

            // Generate CSV
            let csv = 'Date,Name,Email,Phone,Status,Reward\n';
            
            referrals.forEach(r => {
                const row = [
                    r.created_at.toISOString().split('T')[0],
                    r.referred_user_id?.name || r.referred_email || 'Pending',
                    r.referred_user_id?.email || r.referred_email || '',
                    r.referred_user_id?.phone || r.referred_phone || '',
                    this.getStatusLabel(r.status),
                    r.reward_amount || 0
                ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',');
                
                csv += row + '\n';
            });

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=referrals.csv');
            res.send(csv);
        } catch (error) {
            logger.error('Export referrals error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to export referrals'
            });
        }
    }
}

module.exports = new ReferralController();