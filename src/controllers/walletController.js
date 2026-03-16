const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const flutterwaveService = require('../services/flutterwaveService');
const emailService = require('../services/emailService');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

class WalletController {

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/wallet  — wallet balance & info
    // ─────────────────────────────────────────────────────────────────────────
    async getWalletInfo(req, res) {
        try {
            const wallet = await Wallet.findOne({ user_id: req.user._id });
            if (!wallet) {
                return res.status(404).json({ ok: false, error: 'Wallet not found' });
            }
            res.json({
                ok: true,
                wallet: {
                    id:                wallet._id,
                    balance:           wallet.balance,
                    formatted_balance: wallet.formatted_balance,
                    currency:          wallet.currency,
                    status:            wallet.status,
                    tier:              wallet.tier,
                    limits:            wallet.limits
                }
            });
        } catch (error) {
            logger.error('Get wallet info error:', error);
            res.status(500).json({ ok: false, error: 'Server error' });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/wallet/transactions
    // ─────────────────────────────────────────────────────────────────────────
    async getTransactions(req, res) {
        try {
            const page  = parseInt(req.query.page)  || 1;
            const limit = parseInt(req.query.limit) || 20;
            const skip  = (page - 1) * limit;
            const { type, status, from, to } = req.query;

            const query = { user_id: req.user._id };
            if (type)   query.type   = type;
            if (status) query.status = status;
            if (from || to) {
                query.created_at = {};
                if (from) query.created_at.$gte = new Date(from);
                if (to)   query.created_at.$lte = new Date(to);
            }

            const [transactions, total] = await Promise.all([
                Transaction.find(query).sort({ created_at: -1 }).skip(skip).limit(limit),
                Transaction.countDocuments(query)
            ]);

            res.json({
                ok: true,
                transactions: transactions.map(t => ({
                    id:               t._id,
                    type:             t.type,
                    provider:         t.provider,
                    amount:           t.amount,
                    formatted_amount: t.formatted_amount,
                    status:           t.status,
                    status_badge:     t.status_badge,
                    reference:        t.reference,
                    details:          t.details,
                    created_at:       t.created_at,
                    metadata:         t.metadata
                })),
                pagination: { page, limit, total, pages: Math.ceil(total / limit) }
            });
        } catch (error) {
            logger.error('Get transactions error:', error);
            res.status(500).json({ ok: false, error: 'Server error' });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/wallet/transactions/:id
    // ─────────────────────────────────────────────────────────────────────────
    async getTransaction(req, res) {
        try {
            const transaction = await Transaction.findOne({
                _id:     req.params.id,
                user_id: req.user._id
            });
            if (!transaction) {
                return res.status(404).json({ ok: false, error: 'Transaction not found' });
            }
            res.json({
                ok: true,
                transaction: {
                    id:               transaction._id,
                    type:             transaction.type,
                    provider:         transaction.provider,
                    amount:           transaction.amount,
                    formatted_amount: transaction.formatted_amount,
                    fee:              transaction.fee,
                    currency:         transaction.currency,
                    status:           transaction.status,
                    reference:        transaction.reference,
                    external_ref:     transaction.external_ref,
                    account_target:   transaction.account_target,
                    details:          transaction.details,
                    metadata:         transaction.metadata,
                    created_at:       transaction.created_at,
                    processed_at:     transaction.processed_at
                }
            });
        } catch (error) {
            logger.error('Get transaction error:', error);
            res.status(500).json({ ok: false, error: 'Server error' });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/wallet/fund  — initialise Flutterwave payment
    // ─────────────────────────────────────────────────────────────────────────
    async fundWallet(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ ok: false, error: errors.array()[0].msg });
        }

        const { amount, method } = req.body;
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            const wallet = await Wallet.findOne({ user_id: req.user._id }).session(session);
            if (!wallet) {
                await session.abortTransaction(); session.endSession();
                return res.status(404).json({ ok: false, error: 'Wallet not found' });
            }
            if (wallet.status !== 'active') {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: `Wallet is not active. Status: ${wallet.status}` });
            }

            const txRef = Transaction.generateReference('flutterwave');

            await Transaction.create([{
                user_id:    req.user._id,
                wallet_id:  wallet._id,
                type:       'credit',
                provider:   'flutterwave',
                amount:     parseFloat(amount),
                currency:   'NGN',
                status:     'pending',
                reference:  txRef,
                details:    `Wallet funding via Flutterwave (${method || 'card'})`,
                metadata: {
                    purpose:       'wallet_funding',
                    method:        method || 'card',
                    user_id:       req.user._id.toString(),
                    wallet_id:     wallet._id.toString(),
                    amount_naira:  amount
                },
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }], { session });

            await session.commitTransaction();
            session.endSession();

            // ── No Flutterwave keys → test/demo mode ──────────────────────
            if (!process.env.FLW_PUBLIC_KEY || !process.env.FLW_SECRET_KEY) {
                return res.json({
                    ok:              true,
                    test_mode:       true,
                    link:            '#',
                    ref:             txRef,
                    amount:          parseFloat(amount),
                    current_balance: wallet.balance,
                    message:         'TEST MODE: Add FLW keys to enable real payments.'
                });
            }

            // ── Build redirect URL that the callback handler can process ──
            //    We use a dedicated endpoint so the processing is server-side.
            const callbackUrl =
                `${process.env.BASE_URL}/api/payment/callback?tx_ref=${txRef}`;

            const paymentData = {
                tx_ref:          txRef,
                amount:          parseFloat(amount),
                currency:        'NGN',
                redirect_url:    callbackUrl,
                payment_options: method === 'card' ? 'card' : 'account,ussd,banktransfer',
                customer: {
                    email:       req.user.email,
                    phonenumber: req.user.phone || '08000000000',
                    name:        req.user.name
                },
                customizations: {
                    title:       'MozAic — Wallet Funding',
                    description: 'Top up your wallet balance',
                    logo:        `${process.env.BASE_URL}/assets/img/logo.png`
                },
                meta: {
                    user_id:   req.user._id.toString(),
                    wallet_id: wallet._id.toString(),
                    purpose:   'wallet_funding'
                }
            };

            const flwResponse = await flutterwaveService.initializePayment(paymentData);

            if (!flwResponse.ok || !flwResponse.data?.data?.link) {
                throw new Error(flwResponse.data?.message || 'Failed to create payment link');
            }

            res.json({
                ok:              true,
                link:            flwResponse.data.data.link,
                ref:             txRef,
                amount:          parseFloat(amount),
                current_balance: wallet.balance,
                message:         'Payment link generated successfully'
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            logger.error('Fund wallet error:', error);
            res.status(500).json({ ok: false, error: error.message || 'Failed to initiate payment' });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/payment/callback
    //
    // Flutterwave redirects the USER's browser here after payment.
    // We verify the transaction with Flutterwave, credit the wallet, then
    // send the user to the dashboard with a success/fail query parameter.
    // This must be a GET (browser redirect) and must NOT require auth
    // middleware (session may not carry over from the payment gateway).
    // ─────────────────────────────────────────────────────────────────────────
    async handlePaymentCallback(req, res) {
        const { tx_ref, status, transaction_id } = req.query;

        logger.info(`Payment callback received: tx_ref=${tx_ref} status=${status} transaction_id=${transaction_id}`);

        if (!tx_ref) {
            logger.warn('Payment callback missing tx_ref');
            return res.redirect('/dashboard/user?payment_error=missing_reference');
        }

        // ── If Flutterwave said the payment failed outright ────────────────
        if (status && ['cancelled', 'failed'].includes(status.toLowerCase())) {
            await Transaction.findOneAndUpdate(
                { reference: tx_ref, status: 'pending' },
                { status: 'failed', failed_reason: `Payment ${status} by user` }
            ).catch(err => logger.error('Failed to mark cancelled tx:', err));

            return res.redirect(`/dashboard/user?payment_failed=1&tx_ref=${encodeURIComponent(tx_ref)}&status=${status}`);
        }

        // ── Look up the pending transaction ───────────────────────────────
        let transaction;
        try {
            transaction = await Transaction.findOne({ reference: tx_ref });
        } catch (err) {
            logger.error('Callback DB lookup error:', err);
            return res.redirect(`/dashboard/user?payment_error=db_error&tx_ref=${encodeURIComponent(tx_ref)}`);
        }

        if (!transaction) {
            logger.warn(`Callback: transaction not found for ref ${tx_ref}`);
            return res.redirect(`/dashboard/user?payment_error=transaction_not_found&tx_ref=${encodeURIComponent(tx_ref)}`);
        }

        // ── Already processed (idempotency) ───────────────────────────────
        if (transaction.status === 'success') {
            const wallet = await Wallet.findById(transaction.wallet_id).catch(() => null);
            return res.redirect(
                `/dashboard/user?payment_success=1&tx_ref=${encodeURIComponent(tx_ref)}&amount=${transaction.amount}&balance=${wallet?.balance || 0}`
            );
        }

        // ── Verify with Flutterwave ────────────────────────────────────────
        let verified = false;
        let flwData  = null;

        // Strategy 1 — verify by Flutterwave transaction_id (most reliable)
        if (transaction_id) {
            try {
                const verifyResponse = await flutterwaveService.verifyTransaction(transaction_id);
                if (verifyResponse.ok && verifyResponse.data?.data?.status === 'successful') {
                    verified = true;
                    flwData  = verifyResponse.data.data;
                }
            } catch (err) {
                logger.warn('Verify by transaction_id failed:', err.message);
            }
        }

        // Strategy 2 — verify by tx_ref if strategy 1 failed
        if (!verified) {
            try {
                const refResponse = await flutterwaveService.getTransactionByRef(tx_ref);
                if (refResponse.ok && refResponse.data?.data?.status === 'successful') {
                    verified = true;
                    flwData  = refResponse.data.data;
                }
            } catch (err) {
                logger.warn('Verify by tx_ref failed:', err.message);
            }
        }

        // Strategy 3 — trust the status param as last resort (risky but
        //              prevents transactions being stuck if Flutterwave API
        //              is briefly unavailable)
        if (!verified && status === 'successful') {
            logger.warn(`Using status param fallback for tx_ref=${tx_ref} — could not verify with API`);
            verified = true;
        }

        if (!verified) {
            await Transaction.findOneAndUpdate(
                { reference: tx_ref, status: 'pending' },
                { status: 'failed', failed_reason: 'Payment not verified with Flutterwave' }
            ).catch(err => logger.error('Failed to mark unverified tx as failed:', err));

            return res.redirect(`/dashboard/user?payment_failed=1&tx_ref=${encodeURIComponent(tx_ref)}&status=unverified`);
        }

        // ── Credit the wallet (in a DB transaction) ───────────────────────
        const dbSession = await mongoose.startSession();
        try {
            dbSession.startTransaction();

            // Re-fetch inside session & re-check (race condition guard)
            const freshTx = await Transaction.findOne({ reference: tx_ref }).session(dbSession);
            if (freshTx.status === 'success') {
                await dbSession.abortTransaction();
                dbSession.endSession();
                const wallet = await Wallet.findById(freshTx.wallet_id);
                return res.redirect(
                    `/dashboard/user?payment_success=1&tx_ref=${encodeURIComponent(tx_ref)}&amount=${freshTx.amount}&balance=${wallet?.balance || 0}`
                );
            }

            // Update transaction
            freshTx.status       = 'success';
            freshTx.external_ref = transaction_id || flwData?.id?.toString() || freshTx.external_ref;
            freshTx.processed_at = new Date();
            freshTx.metadata     = {
                ...freshTx.metadata,
                flw_verification: flwData,
                verified_at:      new Date().toISOString(),
                verified_via:     'payment_callback'
            };
            await freshTx.save({ session: dbSession });

            // Credit wallet
            const wallet = await Wallet.findById(freshTx.wallet_id).session(dbSession);
            if (!wallet) throw new Error('Wallet not found for transaction');

            await wallet.credit(freshTx.amount, dbSession);

            await dbSession.commitTransaction();
            dbSession.endSession();

            logger.info(`Wallet funded via callback: ${tx_ref} — ₦${freshTx.amount}`);

            // Send receipt email async (don't block redirect)
            const user = await User.findById(freshTx.user_id).catch(() => null);
            if (user) {
                emailService.sendTransactionReceipt(user, freshTx)
                    .catch(err => logger.error('Receipt email failed:', err));
            }

            return res.redirect(
                `/dashboard/user?payment_success=1&tx_ref=${encodeURIComponent(tx_ref)}&amount=${freshTx.amount}&balance=${wallet.balance}`
            );

        } catch (error) {
            await dbSession.abortTransaction();
            dbSession.endSession();
            logger.error('Callback credit error:', error);
            return res.redirect(`/dashboard/user?payment_error=processing_error&tx_ref=${encodeURIComponent(tx_ref)}`);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/webhook/flutterwave
    //
    // Server-to-server notification from Flutterwave.
    // FLW_WEBHOOK_SECRET must be set in Render env vars.
    // If it is NOT set we fall through to processing anyway (dev/test mode)
    // rather than silently dropping the event.
    // ─────────────────────────────────────────────────────────────────────────
    async handleFlutterwaveWebhook(req, res) {
        const signature = req.headers['verif-hash'];
        const payload   = req.body;

        // ── Signature check — skip if no secret configured ────────────────
        if (process.env.FLW_WEBHOOK_SECRET) {
            if (!flutterwaveService.verifyWebhookSignature(signature, payload)) {
                logger.warn('Invalid Flutterwave webhook signature — rejected');
                return res.status(401).json({ status: 'error', message: 'Invalid signature' });
            }
        } else {
            logger.warn('FLW_WEBHOOK_SECRET not set — skipping signature check');
        }

        // Always acknowledge quickly to prevent Flutterwave retries
        res.status(200).json({ status: 'success' });

        // ── Process async so we don't block the response ──────────────────
        setImmediate(() => this._processWebhookEvent(payload));
    }

    async _processWebhookEvent(payload) {
        const event = payload.event;
        const data  = payload.data;

        logger.info(`Flutterwave webhook event: ${event}`, { tx_ref: data?.tx_ref });

        if (event !== 'charge.completed') return;

        const { tx_ref, id: flw_id, amount, status } = data;
        if (!tx_ref) return;

        const dbSession = await mongoose.startSession();
        try {
            dbSession.startTransaction();

            const transaction = await Transaction.findOne({ reference: tx_ref }).session(dbSession);

            if (!transaction) {
                logger.warn(`Webhook: no transaction for ref ${tx_ref}`);
                await dbSession.abortTransaction(); dbSession.endSession();
                return;
            }

            if (transaction.status === 'success') {
                logger.info(`Webhook: transaction ${tx_ref} already succeeded — skipping`);
                await dbSession.abortTransaction(); dbSession.endSession();
                return;
            }

            // ── Verify with Flutterwave before crediting ──────────────────
            const verifyResponse = await flutterwaveService.verifyTransaction(flw_id);
            if (!verifyResponse.ok || verifyResponse.data?.data?.status !== 'successful') {
                logger.warn(`Webhook: Flutterwave verification failed for ${tx_ref}`);
                transaction.status        = 'failed';
                transaction.failed_reason = 'Webhook: payment not verified';
                await transaction.save({ session: dbSession });
                await dbSession.commitTransaction(); dbSession.endSession();
                return;
            }

            // ── Credit wallet ─────────────────────────────────────────────
            const wallet = await Wallet.findById(transaction.wallet_id).session(dbSession);
            if (!wallet) {
                logger.error(`Webhook: wallet not found for transaction ${tx_ref}`);
                await dbSession.abortTransaction(); dbSession.endSession();
                return;
            }

            transaction.status       = 'success';
            transaction.external_ref = flw_id?.toString();
            transaction.processed_at = new Date();
            transaction.metadata     = {
                ...transaction.metadata,
                flutterwave_data: verifyResponse.data.data,
                verified_at:      new Date().toISOString(),
                verified_via:     'webhook'
            };
            await transaction.save({ session: dbSession });
            await wallet.credit(transaction.amount, dbSession);

            await dbSession.commitTransaction();
            dbSession.endSession();

            logger.info(`Webhook: wallet credited ₦${transaction.amount} for ${tx_ref}`);

            // Send receipt async
            const user = await User.findById(transaction.user_id).catch(() => null);
            if (user) {
                emailService.sendTransactionReceipt(user, transaction)
                    .catch(err => logger.error('Receipt email failed:', err));
            }

        } catch (error) {
            await dbSession.abortTransaction();
            dbSession.endSession();
            logger.error('Webhook processing error:', error);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/wallet/requery  — manual status check + reconcile
    // ─────────────────────────────────────────────────────────────────────────
    async requeryTransaction(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ ok: false, error: errors.array()[0].msg });
        }

        const { reference } = req.body;

        try {
            const transaction = await Transaction.findOne({
                reference,
                user_id: req.user._id
            });

            if (!transaction) {
                return res.status(404).json({ ok: false, error: 'Transaction not found' });
            }

            // Already terminal — just return
            if (!['pending', 'processing'].includes(transaction.status)) {
                return res.json({
                    ok:        true,
                    status:    transaction.status,
                    amount:    transaction.amount,
                    reference: transaction.reference,
                    message:   `Transaction is already ${transaction.status}`
                });
            }

            // ── Flutterwave funding transactions ──────────────────────────
            if (transaction.provider === 'flutterwave') {
                let verified = false;
                let flwData  = null;

                // Try by external_ref first (fastest)
                if (transaction.external_ref) {
                    const r = await flutterwaveService.verifyTransaction(transaction.external_ref);
                    if (r.ok && r.data?.data?.status === 'successful') {
                        verified = true; flwData = r.data.data;
                    }
                }

                // Try by tx_ref
                if (!verified) {
                    const r = await flutterwaveService.getTransactionByRef(reference);
                    if (r.ok && r.data?.data?.status === 'successful') {
                        verified = true; flwData = r.data.data;
                    }
                }

                if (verified) {
                    const dbSession = await mongoose.startSession();
                    try {
                        dbSession.startTransaction();

                        const freshTx = await Transaction.findOne({ reference }).session(dbSession);
                        if (freshTx.status === 'success') {
                            await dbSession.abortTransaction(); dbSession.endSession();
                            return res.json({ ok: true, status: 'success', amount: freshTx.amount, reference });
                        }

                        const wallet = await Wallet.findById(freshTx.wallet_id).session(dbSession);
                        if (!wallet) throw new Error('Wallet not found');

                        freshTx.status       = 'success';
                        freshTx.external_ref = flwData?.id?.toString() || freshTx.external_ref;
                        freshTx.processed_at = new Date();
                        freshTx.metadata     = {
                            ...freshTx.metadata,
                            flw_verification: flwData,
                            verified_at:      new Date().toISOString(),
                            verified_via:     'manual_requery'
                        };
                        await freshTx.save({ session: dbSession });
                        await wallet.credit(freshTx.amount, dbSession);

                        await dbSession.commitTransaction();
                        dbSession.endSession();

                        logger.info(`Requery: credited ₦${freshTx.amount} for ${reference}`);

                        return res.json({
                            ok:          true,
                            status:      'success',
                            amount:      freshTx.amount,
                            reference,
                            new_balance: wallet.balance,
                            message:     'Transaction verified and wallet credited!'
                        });

                    } catch (err) {
                        await dbSession.abortTransaction();
                        dbSession.endSession();
                        throw err;
                    }
                }

                // Could not verify — leave as pending
                return res.json({
                    ok:        true,
                    status:    'pending',
                    amount:    transaction.amount,
                    reference,
                    message:   'Transaction is still pending with Flutterwave. Please wait a few minutes and try again.'
                });
            }

            // ── Other providers ───────────────────────────────────────────
            return res.json({
                ok:        true,
                status:    transaction.status,
                amount:    transaction.amount,
                reference,
                message:   `Current status: ${transaction.status}`
            });

        } catch (error) {
            logger.error('Requery error:', error);
            res.status(500).json({ ok: false, error: error.message || 'Requery failed' });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/wallet/reconcile-pending
    //
    // Admin / background job: check ALL pending Flutterwave transactions
    // older than 5 minutes and try to reconcile them.
    // ─────────────────────────────────────────────────────────────────────────
    async reconcilePendingTransactions(req, res) {
        try {
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

            const pendingTxs = await Transaction.find({
                provider:   'flutterwave',
                status:     'pending',
                created_at: { $lt: fiveMinutesAgo }
            }).limit(50);   // safety cap

            logger.info(`Reconcile: found ${pendingTxs.length} pending Flutterwave transactions`);

            const results = { credited: 0, failed: 0, still_pending: 0, errors: [] };

            for (const tx of pendingTxs) {
                try {
                    let verified = false;
                    let flwData  = null;

                    if (tx.external_ref) {
                        const r = await flutterwaveService.verifyTransaction(tx.external_ref);
                        if (r.ok && r.data?.data?.status === 'successful') {
                            verified = true; flwData = r.data.data;
                        }
                    }

                    if (!verified) {
                        const r = await flutterwaveService.getTransactionByRef(tx.reference);
                        if (r.ok && r.data?.data?.status === 'successful') {
                            verified = true; flwData = r.data.data;
                        } else if (r.ok && r.data?.data?.status === 'failed') {
                            tx.status        = 'failed';
                            tx.failed_reason = 'Reconciliation: Flutterwave reports failed';
                            await tx.save();
                            results.failed++;
                            continue;
                        }
                    }

                    if (!verified) {
                        results.still_pending++;
                        continue;
                    }

                    // Credit wallet
                    const dbSession = await mongoose.startSession();
                    try {
                        dbSession.startTransaction();

                        const freshTx = await Transaction.findById(tx._id).session(dbSession);
                        if (freshTx.status !== 'pending') {
                            await dbSession.abortTransaction(); dbSession.endSession();
                            continue;
                        }

                        const wallet = await Wallet.findById(freshTx.wallet_id).session(dbSession);
                        if (!wallet) throw new Error('Wallet not found');

                        freshTx.status       = 'success';
                        freshTx.processed_at = new Date();
                        freshTx.metadata     = {
                            ...freshTx.metadata,
                            flw_verification: flwData,
                            verified_at:      new Date().toISOString(),
                            verified_via:     'reconciliation_job'
                        };
                        await freshTx.save({ session: dbSession });
                        await wallet.credit(freshTx.amount, dbSession);

                        await dbSession.commitTransaction();
                        dbSession.endSession();

                        results.credited++;
                        logger.info(`Reconcile: credited ₦${freshTx.amount} for ${freshTx.reference}`);

                    } catch (innerErr) {
                        await dbSession.abortTransaction();
                        dbSession.endSession();
                        throw innerErr;
                    }

                } catch (txErr) {
                    results.errors.push({ reference: tx.reference, error: txErr.message });
                    logger.error(`Reconcile error for ${tx.reference}:`, txErr);
                }
            }

            logger.info('Reconcile results:', results);
            res.json({ ok: true, results });

        } catch (error) {
            logger.error('Reconcile job error:', error);
            res.status(500).json({ ok: false, error: error.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/wallet/withdraw
    // ─────────────────────────────────────────────────────────────────────────
    async withdraw(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ ok: false, error: errors.array()[0].msg });
        }

        const { amount, bank, account, account_name } = req.body;
        const session = await mongoose.startSession();

        try {
            session.startTransaction();

            const wallet = await Wallet.findOne({ user_id: req.user._id }).session(session);
            if (!wallet) {
                await session.abortTransaction(); session.endSession();
                return res.status(404).json({ ok: false, error: 'Wallet not found' });
            }
            if (wallet.status !== 'active') {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: `Wallet is not active. Status: ${wallet.status}` });
            }
            if (!wallet.hasSufficientBalance(parseFloat(amount))) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: `Insufficient balance. Available: ${wallet.formatted_balance}` });
            }

            const txRef = Transaction.generateReference('withdrawal');

            await Transaction.create([{
                user_id:        req.user._id,
                wallet_id:      wallet._id,
                type:           'debit',
                provider:       'withdrawal',
                amount:         parseFloat(amount),
                currency:       'NGN',
                status:         'pending',
                reference:      txRef,
                account_target: account,
                details:        `Withdrawal to ${bank} — ${account}`,
                metadata:       { bank, account, account_name, purpose: 'wallet_withdrawal' },
                ip_address:     req.ip,
                user_agent:     req.headers['user-agent']
            }], { session });

            await wallet.debit(parseFloat(amount), session);
            await session.commitTransaction();
            session.endSession();

            emailService.sendWithdrawalNotification(req.user, { amount, bank, account, reference: txRef })
                .catch(err => logger.error('Withdrawal email failed:', err));

            res.json({
                ok:          true,
                reference:   txRef,
                amount:      parseFloat(amount),
                new_balance: wallet.balance,
                message:     'Withdrawal request submitted successfully'
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            logger.error('Withdrawal error:', error);
            res.status(500).json({ ok: false, error: error.message || 'Withdrawal failed' });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/wallet/stats
    // ─────────────────────────────────────────────────────────────────────────
    async getWalletStats(req, res) {
        try {
            const today        = new Date(); today.setHours(0, 0, 0, 0);
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

            const [todayTotal, monthTotal, typeCounts] = await Promise.all([
                Transaction.aggregate([
                    { $match: { user_id: req.user._id, created_at: { $gte: today }, status: 'success' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]),
                Transaction.aggregate([
                    { $match: { user_id: req.user._id, created_at: { $gte: startOfMonth }, status: 'success' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]),
                Transaction.aggregate([
                    { $match: { user_id: req.user._id, status: 'success' } },
                    { $group: { _id: '$type', count: { $sum: 1 }, total: { $sum: '$amount' } } }
                ])
            ]);

            res.json({
                ok: true,
                stats: {
                    today:   todayTotal[0]?.total  || 0,
                    month:   monthTotal[0]?.total  || 0,
                    by_type: typeCounts.reduce((acc, curr) => {
                        acc[curr._id] = { count: curr.count, total: curr.total };
                        return acc;
                    }, {})
                }
            });
        } catch (error) {
            logger.error('Get wallet stats error:', error);
            res.status(500).json({ ok: false, error: 'Server error' });
        }
    }
}

module.exports = new WalletController();