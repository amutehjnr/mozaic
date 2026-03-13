const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const flutterwaveService = require('../services/flutterwaveService');
const emailService = require('../services/emailService');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

class WalletController {
    /**
     * Get wallet balance and info
     */
    async getWalletInfo(req, res) {
        try {
            const wallet = await Wallet.findOne({ user_id: req.user._id });
            
            if (!wallet) {
                return res.status(404).json({
                    ok: false,
                    error: 'Wallet not found'
                });
            }

            res.json({
                ok: true,
                wallet: {
                    id: wallet._id,
                    balance: wallet.balance,
                    formatted_balance: wallet.formatted_balance,
                    currency: wallet.currency,
                    status: wallet.status,
                    tier: wallet.tier,
                    limits: wallet.limits
                }
            });
        } catch (error) {
            logger.error('Get wallet info error:', error);
            res.status(500).json({
                ok: false,
                error: 'Server error'
            });
        }
    }

    /**
     * Get transaction history
     */
    async getTransactions(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const skip = (page - 1) * limit;
            const { type, status, from, to } = req.query;

            // Build query
            const query = { user_id: req.user._id };
            
            if (type) query.type = type;
            if (status) query.status = status;
            
            if (from || to) {
                query.created_at = {};
                if (from) query.created_at.$gte = new Date(from);
                if (to) query.created_at.$lte = new Date(to);
            }

            // Get transactions
            const transactions = await Transaction.find(query)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit);

            const total = await Transaction.countDocuments(query);

            res.json({
                ok: true,
                transactions: transactions.map(t => ({
                    id: t._id,
                    type: t.type,
                    provider: t.provider,
                    amount: t.amount,
                    formatted_amount: t.formatted_amount,
                    status: t.status,
                    status_badge: t.status_badge,
                    reference: t.reference,
                    details: t.details,
                    created_at: t.created_at,
                    metadata: t.metadata
                })),
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
                error: 'Server error'
            });
        }
    }

    /**
     * Get single transaction
     */
    async getTransaction(req, res) {
        try {
            const { id } = req.params;

            const transaction = await Transaction.findOne({
                _id: id,
                user_id: req.user._id
            });

            if (!transaction) {
                return res.status(404).json({
                    ok: false,
                    error: 'Transaction not found'
                });
            }

            res.json({
                ok: true,
                transaction: {
                    id: transaction._id,
                    type: transaction.type,
                    provider: transaction.provider,
                    amount: transaction.amount,
                    formatted_amount: transaction.formatted_amount,
                    fee: transaction.fee,
                    currency: transaction.currency,
                    status: transaction.status,
                    reference: transaction.reference,
                    external_ref: transaction.external_ref,
                    account_target: transaction.account_target,
                    details: transaction.details,
                    metadata: transaction.metadata,
                    created_at: transaction.created_at,
                    processed_at: transaction.processed_at
                }
            });
        } catch (error) {
            logger.error('Get transaction error:', error);
            res.status(500).json({
                ok: false,
                error: 'Server error'
            });
        }
    }

    /**
     * Initialize wallet funding
     */
    async fundWallet(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                ok: false,
                error: errors.array()[0].msg
            });
        }

        const { amount, method } = req.body;
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            // Get wallet
            const wallet = await Wallet.findOne({ user_id: req.user._id }).session(session);
            
            if (!wallet) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({
                    ok: false,
                    error: 'Wallet not found'
                });
            }

            if (wallet.status !== 'active') {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    ok: false,
                    error: `Wallet is not active. Status: ${wallet.status}`
                });
            }

            // Create transaction reference
            const txRef = Transaction.generateReference('flutterwave');

            // Create pending transaction
            const transaction = await Transaction.create([{
                user_id: req.user._id,
                wallet_id: wallet._id,
                type: 'credit',
                provider: 'flutterwave',
                amount: parseFloat(amount),
                currency: 'NGN',
                status: 'pending',
                reference: txRef,
                details: `Wallet funding via Flutterwave (${method})`,
                metadata: {
                    purpose: 'wallet_funding',
                    method,
                    user_id: req.user._id,
                    wallet_id: wallet._id,
                    amount_naira: amount
                },
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }], { session });

            await session.commitTransaction();
            session.endSession();

            // Check if Flutterwave is configured
            if (!process.env.FLW_PUBLIC_KEY || !process.env.FLW_SECRET_KEY) {
                return res.json({
                    ok: true,
                    test_mode: true,
                    link: '#',
                    ref: txRef,
                    amount: parseFloat(amount),
                    current_balance: wallet.balance,
                    message: 'TEST MODE: Add Flutterwave API keys to enable real payments. Transaction saved as pending.'
                });
            }

            // Prepare customer data
            const customer = {
                email: req.user.email,
                phonenumber: req.user.phone || '08000000000',
                name: req.user.name
            };

            // Build callback URL
            const callbackUrl = `${process.env.BASE_URL}/dashboard/user?payment_callback=1&tx_ref=${txRef}`;

            // Create Flutterwave payment
            const paymentData = {
                tx_ref: txRef,
                amount: parseFloat(amount),
                currency: 'NGN',
                redirect_url: callbackUrl,
                payment_options: method === 'card' ? 'card' : 'account,ussd,banktransfer',
                customer,
                customizations: {
                    title: 'MozAic - Wallet Funding',
                    description: 'Top up your wallet balance',
                    logo: `${process.env.BASE_URL}/assets/img/logo.png`
                },
                meta: {
                    user_id: req.user._id.toString(),
                    wallet_id: wallet._id.toString(),
                    purpose: 'wallet_funding'
                }
            };

            const flwResponse = await flutterwaveService.initializePayment(paymentData);

            if (!flwResponse.ok || !flwResponse.data?.data?.link) {
                throw new Error(flwResponse.data?.message || 'Failed to create payment link');
            }

            res.json({
                ok: true,
                link: flwResponse.data.data.link,
                ref: txRef,
                amount: parseFloat(amount),
                current_balance: wallet.balance,
                message: 'Payment link generated successfully'
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            
            logger.error('Fund wallet error:', error);
            res.status(500).json({
                ok: false,
                error: error.message || 'Failed to initiate payment'
            });
        }
    }

    /**
     * Handle Flutterwave webhook
     */
    async handleFlutterwaveWebhook(req, res) {
        const signature = req.headers['verif-hash'];
        const payload = req.body;

        // Verify webhook signature
        if (!flutterwaveService.verifyWebhookSignature(signature, payload)) {
            logger.warn('Invalid webhook signature');
            return res.status(401).json({ status: 'error', message: 'Invalid signature' });
        }

        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            const event = payload.event;
            const data = payload.data;

            if (event === 'charge.completed') {
                const { tx_ref, id, amount, currency, status } = data;

                // Find pending transaction
                const transaction = await Transaction.findOne({ 
                    reference: tx_ref,
                    status: 'pending'
                }).session(session);

                if (!transaction) {
                    logger.warn(`Transaction not found for reference: ${tx_ref}`);
                    await session.abortTransaction();
                    session.endSession();
                    return res.status(200).json({ status: 'success' });
                }

                // Check if already processed
                if (transaction.status === 'success') {
                    await session.abortTransaction();
                    session.endSession();
                    return res.status(200).json({ status: 'success' });
                }

                // Verify with Flutterwave
                const verifyResponse = await flutterwaveService.verifyTransaction(id);
                
                if (!verifyResponse.ok || verifyResponse.data?.data?.status !== 'successful') {
                    transaction.status = 'failed';
                    transaction.failed_reason = 'Payment verification failed';
                    await transaction.save({ session });
                    
                    await session.commitTransaction();
                    session.endSession();
                    
                    return res.status(200).json({ status: 'success' });
                }

                // Update transaction
                transaction.status = 'success';
                transaction.external_ref = id;
                transaction.processed_at = new Date();
                transaction.metadata = {
                    ...transaction.metadata,
                    flutterwave_data: data,
                    verified_at: new Date()
                };
                await transaction.save({ session });

                // Credit wallet
                const wallet = await Wallet.findById(transaction.wallet_id).session(session);
                await wallet.credit(transaction.amount, session);

                // Send receipt email (async)
                const user = await User.findById(transaction.user_id);
                if (user) {
                    emailService.sendTransactionReceipt(user, transaction).catch(err => 
                        logger.error('Failed to send receipt email:', err)
                    );
                }

                logger.info(`Wallet funded successfully: ${tx_ref} - ₦${transaction.amount}`);
            }

            await session.commitTransaction();
            session.endSession();

            res.status(200).json({ status: 'success' });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            
            logger.error('Webhook processing error:', error);
            res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /**
     * Handle payment callback
     */
    async handlePaymentCallback(req, res) {
        const { tx_ref, status, transaction_id } = req.query;

        if (!tx_ref) {
            req.flash('error', 'Missing transaction reference');
            return res.redirect('/dashboard/user');
        }

        try {
            const transaction = await Transaction.findOne({ reference: tx_ref })
                .populate('wallet_id');

            if (!transaction) {
                req.flash('error', 'Transaction not found');
                return res.redirect('/dashboard/user');
            }

            // If already successful
            if (transaction.status === 'success') {
                const amount = transaction.amount;
                const balance = transaction.wallet_id?.balance || 0;
                
                return res.redirect(
                    `/dashboard/user?payment_success=1&tx_ref=${tx_ref}&amount=${amount}&balance=${balance}`
                );
            }

            // Verify with Flutterwave if we have transaction_id
            if (transaction_id) {
                const verifyResponse = await flutterwaveService.verifyTransaction(transaction_id);
                
                if (verifyResponse.ok && verifyResponse.data?.data?.status === 'successful') {
                    // Update transaction
                    transaction.status = 'success';
                    transaction.external_ref = transaction_id;
                    transaction.processed_at = new Date();
                    await transaction.save();

                    // Credit wallet
                    const wallet = await Wallet.findById(transaction.wallet_id);
                    await wallet.credit(transaction.amount);

                    const amount = transaction.amount;
                    const balance = wallet.balance;

                    return res.redirect(
                        `/dashboard/user?payment_success=1&tx_ref=${tx_ref}&amount=${amount}&balance=${balance}`
                    );
                }
            }

            // Check if payment was successful via status param
            if (status === 'successful' || status === 'completed') {
                // Update transaction
                transaction.status = 'success';
                transaction.external_ref = transaction_id || transaction.external_ref;
                transaction.processed_at = new Date();
                await transaction.save();

                // Credit wallet
                const wallet = await Wallet.findById(transaction.wallet_id);
                await wallet.credit(transaction.amount);

                const amount = transaction.amount;
                const balance = wallet.balance;

                return res.redirect(
                    `/dashboard/user?payment_success=1&tx_ref=${tx_ref}&amount=${amount}&balance=${balance}`
                );
            } else {
                // Payment failed
                transaction.status = 'failed';
                transaction.failed_reason = 'Payment cancelled or failed';
                await transaction.save();

                return res.redirect(
                    `/dashboard/user?payment_failed=1&tx_ref=${tx_ref}&status=${status || 'failed'}`
                );
            }

        } catch (error) {
            logger.error('Payment callback error:', error);
            req.flash('error', 'Error processing payment');
            res.redirect('/dashboard/user');
        }
    }

    /**
     * Request withdrawal
     */
    async withdraw(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                ok: false,
                error: errors.array()[0].msg
            });
        }

        const { amount, bank, account, account_name } = req.body;
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            // Get wallet
            const wallet = await Wallet.findOne({ user_id: req.user._id }).session(session);
            
            if (!wallet) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({
                    ok: false,
                    error: 'Wallet not found'
                });
            }

            if (wallet.status !== 'active') {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    ok: false,
                    error: `Wallet is not active. Status: ${wallet.status}`
                });
            }

            // Check balance
            if (!wallet.hasSufficientBalance(parseFloat(amount))) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    ok: false,
                    error: `Insufficient balance. Available: ${wallet.formatted_balance}`
                });
            }

            // Check limits
            if (!wallet.isWithinLimits(parseFloat(amount))) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    ok: false,
                    error: `Amount exceeds per-transaction limit of ₦${wallet.limits.perTransaction / 100}`
                });
            }

            // Create transaction reference
            const txRef = Transaction.generateReference('withdrawal');

            // Create pending transaction
            const transaction = await Transaction.create([{
                user_id: req.user._id,
                wallet_id: wallet._id,
                type: 'debit',
                provider: 'withdrawal',
                amount: parseFloat(amount),
                currency: 'NGN',
                status: 'pending',
                reference: txRef,
                account_target: account,
                details: `Withdrawal to ${bank} - ${account}`,
                metadata: {
                    bank,
                    account,
                    account_name,
                    purpose: 'wallet_withdrawal'
                },
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }], { session });

            // Debit wallet
            await wallet.debit(parseFloat(amount), session);

            await session.commitTransaction();
            session.endSession();

            // Send notification (async)
            emailService.sendWithdrawalNotification(req.user, {
                amount,
                bank,
                account,
                reference: txRef
            }).catch(err => logger.error('Failed to send withdrawal email:', err));

            res.json({
                ok: true,
                reference: txRef,
                amount: parseFloat(amount),
                new_balance: wallet.balance,
                message: 'Withdrawal request submitted successfully'
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            
            logger.error('Withdrawal error:', error);
            res.status(500).json({
                ok: false,
                error: error.message || 'Withdrawal failed'
            });
        }
    }

    /**
     * Get wallet stats
     */
    async getWalletStats(req, res) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const startOfYear = new Date(today.getFullYear(), 0, 1);

            // Get today's total
            const todayTotal = await Transaction.aggregate([
                {
                    $match: {
                        user_id: req.user._id,
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

            // Get month's total
            const monthTotal = await Transaction.aggregate([
                {
                    $match: {
                        user_id: req.user._id,
                        created_at: { $gte: startOfMonth },
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

            // Get year's total
            const yearTotal = await Transaction.aggregate([
                {
                    $match: {
                        user_id: req.user._id,
                        created_at: { $gte: startOfYear },
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

            // Get transaction counts by type
            const typeCounts = await Transaction.aggregate([
                {
                    $match: {
                        user_id: req.user._id,
                        status: 'success'
                    }
                },
                {
                    $group: {
                        _id: '$type',
                        count: { $sum: 1 },
                        total: { $sum: '$amount' }
                    }
                }
            ]);

            res.json({
                ok: true,
                stats: {
                    today: todayTotal[0]?.total || 0,
                    month: monthTotal[0]?.total || 0,
                    year: yearTotal[0]?.total || 0,
                    by_type: typeCounts.reduce((acc, curr) => {
                        acc[curr._id] = {
                            count: curr.count,
                            total: curr.total
                        };
                        return acc;
                    }, {})
                }
            });

        } catch (error) {
            logger.error('Get wallet stats error:', error);
            res.status(500).json({
                ok: false,
                error: 'Server error'
            });
        }
    }

    /**
     * Requery transaction
     */
    async requeryTransaction(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                ok: false,
                error: errors.array()[0].msg
            });
        }

        const { reference } = req.body;

        try {
            // Find transaction
            const transaction = await Transaction.findOne({
                reference,
                user_id: req.user._id
            });

            if (!transaction) {
                return res.status(404).json({
                    ok: false,
                    error: 'Transaction not found'
                });
            }

            // If already successful or failed, return status
            if (transaction.status !== 'pending' && transaction.status !== 'processing') {
                return res.json({
                    ok: true,
                    status: transaction.status,
                    amount: transaction.amount,
                    reference: transaction.reference
                });
            }

            // For Flutterwave transactions
            if (transaction.provider === 'flutterwave' && transaction.external_ref) {
                const verifyResponse = await flutterwaveService.verifyTransaction(transaction.external_ref);
                
                if (verifyResponse.ok && verifyResponse.data?.data) {
                    const flwStatus = verifyResponse.data.data.status;
                    
                    if (flwStatus === 'successful') {
                        transaction.status = 'success';
                        transaction.processed_at = new Date();
                        await transaction.save();

                        // Ensure wallet is credited
                        const wallet = await Wallet.findById(transaction.wallet_id);
                        if (wallet) {
                            // Check if already credited (by webhook)
                            const tx = await Transaction.findOne({
                                reference: transaction.reference,
                                status: 'success'
                            });
                            
                            if (!tx) {
                                await wallet.credit(transaction.amount);
                            }
                        }
                    } else if (flwStatus === 'failed') {
                        transaction.status = 'failed';
                        await transaction.save();
                    }
                }
            }

            // For VTPass transactions
            if (transaction.provider === 'vtpass' && transaction.metadata?.request_id) {
                // Implement VTPass requery
                // This would call VTPass API to check status
            }

            res.json({
                ok: true,
                status: transaction.status,
                amount: transaction.amount,
                reference: transaction.reference
            });

        } catch (error) {
            logger.error('Requery error:', error);
            res.status(500).json({
                ok: false,
                error: error.message || 'Requery failed'
            });
        }
    }
}

module.exports = new WalletController();