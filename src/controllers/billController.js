const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const Beneficiary = require('../models/Beneficiary');
const vtpassService = require('../services/vtpassService');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * Extract a human-readable error message from a VTPass response.
 * VTPass uses several different fields depending on the error type.
 */
function vtpassError(vtpassResponse) {
    const d = vtpassResponse?.data;
    return (
        d?.response_description ||
        d?.error ||
        d?.message ||
        vtpassResponse?.error ||
        'Payment provider request failed'
    );
}

class BillController {
    /**
     * Get data plans
     * Returns a consistent array format so the frontend can always do Array.isArray()
     */
    async getDataPlans(req, res) {
        const { network } = req.query;

        if (!network) {
            return res.status(400).json({ ok: false, error: 'Network is required' });
        }

        try {
            // Return empty plans with a clear message when VTPass is not configured
            if (!vtpassService.isConfigured()) {
                return res.json([]);
            }

            const plans = await vtpassService.getDataPlans(network);
            res.json(Array.isArray(plans) ? plans : []);
        } catch (error) {
            logger.error('Get data plans error:', error);
            res.status(500).json({ ok: false, error: 'Failed to fetch data plans' });
        }
    }

    /**
     * Buy data
     */
    async buyData(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ ok: false, error: errors.array()[0].msg });
        }

        // Guard: VTPass not configured
        if (!vtpassService.isConfigured()) {
            return res.status(503).json({
                ok: false,
                error: 'Data purchase is not available — service credentials are not configured.'
            });
        }

        const { network, phone, planCode, amount, confirm } = req.body;
        const session = await mongoose.startSession();

        try {
            // Preview mode — return details before charging
            if (!confirm || confirm === 'false' || confirm === '0') {
                return res.json({
                    ok: true,
                    preview: true,
                    network: network.toUpperCase(),
                    plan: planCode,
                    phone,
                    amount: parseFloat(amount),
                    fees: 0,
                    total: parseFloat(amount),
                    message: `Confirm purchase of ${network.toUpperCase()} data (${planCode}) for ${phone}`
                });
            }

            session.startTransaction();

            const wallet = await Wallet.findOne({ user_id: req.user._id }).session(session);
            if (!wallet) {
                await session.abortTransaction(); session.endSession();
                return res.status(404).json({ ok: false, error: 'Wallet not found' });
            }
            if (wallet.status !== 'active') {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: `Wallet is not active (${wallet.status})` });
            }
            if (!wallet.hasSufficientBalance(parseFloat(amount))) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: `Insufficient balance. Available: ${wallet.formatted_balance}` });
            }

            const requestId = vtpassService.generateRequestId();
            const vtpassResponse = await vtpassService.buyData(network, phone, planCode, requestId);

            if (!vtpassResponse.ok) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: vtpassError(vtpassResponse) });
            }

            await wallet.debit(parseFloat(amount), session);

            const vtpassData = vtpassResponse.data;
            const transactionId = vtpassData?.content?.transactions?.transactionId || requestId;
            const status = vtpassData?.content?.transactions?.status || 'delivered';

            await Transaction.create([{
                user_id:   req.user._id,
                wallet_id: wallet._id,
                type:      'debit',
                provider:  'data',
                amount:    parseFloat(amount),
                currency:  'NGN',
                status:    status === 'delivered' ? 'success' : 'processing',
                reference: requestId,
                external_ref: transactionId,
                account_target: phone,
                plan_code: planCode,
                details:   `${network.toUpperCase()} data purchase for ${phone}`,
                metadata: {
                    network, plan: planCode, phone,
                    vtpass_response: vtpassData,
                    request_id: requestId,
                    transaction_id: transactionId,
                    wallet_balance_before: wallet.balance + parseFloat(amount),
                    wallet_balance_after:  wallet.balance
                },
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }], { session });

            if (req.body.saveBeneficiary && req.body.saveBeneficiary !== '0') {
                await Beneficiary.create([{
                    user_id:  req.user._id,
                    type:     'data',
                    label:    `${network.toUpperCase()} — ${phone}`,
                    value:    phone,
                    provider: network,
                    metadata: { network, plan: planCode }
                }], { session }).catch(() => {}); // non-fatal
            }

            await session.commitTransaction();
            session.endSession();

            res.json({
                ok:          true,
                ref:         requestId,
                amount:      parseFloat(amount),
                network:     network.toUpperCase(),
                phone,
                plan:        planCode,
                message:     'Data purchase successful',
                new_balance: wallet.balance,
                status
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            logger.error('Buy data error:', error);
            res.status(500).json({ ok: false, error: error.message || 'Data purchase failed' });
        }
    }

    /**
     * Buy airtime
     */
    async buyAirtime(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ ok: false, error: errors.array()[0].msg });
        }

        // Guard: VTPass not configured
        if (!vtpassService.isConfigured()) {
            return res.status(503).json({
                ok: false,
                error: 'Airtime purchase is not available — service credentials are not configured.'
            });
        }

        const { network, phone, amount, confirm } = req.body;
        const session = await mongoose.startSession();

        try {
            if (!confirm || confirm === 'false' || confirm === '0') {
                return res.json({
                    ok: true,
                    preview: true,
                    network: network.toUpperCase(),
                    phone,
                    amount: parseFloat(amount),
                    fees: 0,
                    total: parseFloat(amount),
                    message: `Confirm airtime purchase of ₦${parseFloat(amount).toFixed(2)} for ${phone}`
                });
            }

            session.startTransaction();

            const wallet = await Wallet.findOne({ user_id: req.user._id }).session(session);
            if (!wallet) {
                await session.abortTransaction(); session.endSession();
                return res.status(404).json({ ok: false, error: 'Wallet not found' });
            }
            if (wallet.status !== 'active') {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: `Wallet is not active (${wallet.status})` });
            }
            if (!wallet.hasSufficientBalance(parseFloat(amount))) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: `Insufficient balance. Available: ${wallet.formatted_balance}` });
            }

            const requestId = vtpassService.generateRequestId();
            const vtpassResponse = await vtpassService.buyAirtime(network, phone, amount, requestId);

            if (!vtpassResponse.ok) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: vtpassError(vtpassResponse) });
            }

            await wallet.debit(parseFloat(amount), session);

            const vtpassData = vtpassResponse.data;
            const transactionId = vtpassData?.content?.transactions?.transactionId || requestId;
            const status = vtpassData?.content?.transactions?.status || 'delivered';

            await Transaction.create([{
                user_id:   req.user._id,
                wallet_id: wallet._id,
                type:      'debit',
                provider:  'airtime',
                amount:    parseFloat(amount),
                currency:  'NGN',
                status:    status === 'delivered' ? 'success' : 'processing',
                reference: requestId,
                external_ref: transactionId,
                account_target: phone,
                details:   `${network.toUpperCase()} airtime for ${phone}`,
                metadata: {
                    network, phone, amount,
                    vtpass_response: vtpassData,
                    request_id: requestId,
                    transaction_id: transactionId,
                    wallet_balance_before: wallet.balance + parseFloat(amount),
                    wallet_balance_after:  wallet.balance
                },
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }], { session });

            if (req.body.saveBeneficiary && req.body.saveBeneficiary !== '0') {
                await Beneficiary.create([{
                    user_id:  req.user._id,
                    type:     'airtime',
                    label:    `${network.toUpperCase()} — ${phone}`,
                    value:    phone,
                    provider: network
                }], { session }).catch(() => {});
            }

            await session.commitTransaction();
            session.endSession();

            res.json({
                ok:          true,
                ref:         requestId,
                amount:      parseFloat(amount),
                network:     network.toUpperCase(),
                phone,
                message:     'Airtime purchase successful',
                new_balance: wallet.balance,
                status
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            logger.error('Buy airtime error:', error);
            res.status(500).json({ ok: false, error: error.message || 'Airtime purchase failed' });
        }
    }

    /**
     * Get TV packages
     */
    async getTVPackages(req, res) {
        const { provider, smartcard } = req.query;

        if (!provider) {
            return res.status(400).json({ ok: false, error: 'Provider is required' });
        }

        // Return empty packages when VTPass is not configured
        if (!vtpassService.isConfigured()) {
            return res.json({ ok: true, packages: [], customerName: null, smartcard });
        }

        try {
            const result = await vtpassService.getTVPackages(provider, smartcard);

            res.json({
                ok: true,
                packages: result.packages || [],
                customerName: result.customerName || null,
                smartcard
            });
        } catch (error) {
            logger.error('Get TV packages error:', error);
            res.status(500).json({ ok: false, error: 'Failed to fetch TV packages' });
        }
    }

    /**
     * Buy TV subscription
     */
    async buyTV(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ ok: false, error: errors.array()[0].msg });
        }

        // Guard: VTPass not configured
        if (!vtpassService.isConfigured()) {
            return res.status(503).json({
                ok: false,
                error: 'TV subscription is not available — service credentials are not configured.'
            });
        }

        const { provider, card, package: packageCode, amount, phone, confirm } = req.body;
        const session = await mongoose.startSession();

        try {
            if (!confirm || confirm === 'false' || confirm === '0') {
                return res.json({
                    ok: true,
                    preview: true,
                    provider: provider.toUpperCase(),
                    package: packageCode,
                    smartcard: card,
                    amount: parseFloat(amount),
                    fees: 0,
                    total: parseFloat(amount),
                    message: `Confirm ${provider.toUpperCase()} subscription of ₦${parseFloat(amount).toFixed(2)} for ${card}`
                });
            }

            session.startTransaction();

            const wallet = await Wallet.findOne({ user_id: req.user._id }).session(session);
            if (!wallet) {
                await session.abortTransaction(); session.endSession();
                return res.status(404).json({ ok: false, error: 'Wallet not found' });
            }
            if (wallet.status !== 'active') {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: `Wallet is not active (${wallet.status})` });
            }
            if (!wallet.hasSufficientBalance(parseFloat(amount))) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: `Insufficient balance. Available: ${wallet.formatted_balance}` });
            }

            const requestId = vtpassService.generateRequestId();
            const vtpassResponse = await vtpassService.buyTV(provider, card, packageCode, phone || card, requestId);

            if (!vtpassResponse.ok) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: vtpassError(vtpassResponse) });
            }

            await wallet.debit(parseFloat(amount), session);

            const vtpassData = vtpassResponse.data;
            const transactionId = vtpassData?.content?.transactions?.transactionId || requestId;
            const status = vtpassData?.content?.transactions?.status || 'delivered';

            await Transaction.create([{
                user_id:   req.user._id,
                wallet_id: wallet._id,
                type:      'debit',
                provider:  'tv',
                amount:    parseFloat(amount),
                currency:  'NGN',
                status:    status === 'delivered' ? 'success' : 'processing',
                reference: requestId,
                external_ref: transactionId,
                account_target: card,
                plan_code: packageCode,
                details:   `${provider.toUpperCase()} subscription for ${card}`,
                metadata: {
                    provider, package: packageCode, smartcard: card,
                    vtpass_response: vtpassData,
                    request_id: requestId,
                    transaction_id: transactionId,
                    wallet_balance_before: wallet.balance + parseFloat(amount),
                    wallet_balance_after:  wallet.balance
                },
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }], { session });

            await session.commitTransaction();
            session.endSession();

            res.json({
                ok:          true,
                ref:         requestId,
                amount:      parseFloat(amount),
                provider:    provider.toUpperCase(),
                smartcard:   card,
                package:     packageCode,
                message:     'TV subscription successful',
                new_balance: wallet.balance,
                status
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            logger.error('Buy TV error:', error);
            res.status(500).json({ ok: false, error: error.message || 'TV subscription failed' });
        }
    }

    /**
     * Pay electricity
     */
    async payElectricity(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ ok: false, error: errors.array()[0].msg });
        }

        // Guard: VTPass not configured
        if (!vtpassService.isConfigured()) {
            return res.status(503).json({
                ok: false,
                error: 'Electricity payment is not available — service credentials are not configured.'
            });
        }

        const { disco, meterNo, meterType, amount, phone, confirm } = req.body;
        const session = await mongoose.startSession();

        try {
            if (!confirm || confirm === 'false' || confirm === '0') {
                return res.json({
                    ok: true,
                    preview: true,
                    disco: disco.toUpperCase(),
                    meterNo,
                    meterType,
                    amount: parseFloat(amount),
                    fees: 0,
                    total: parseFloat(amount),
                    message: `Confirm electricity payment of ₦${parseFloat(amount).toFixed(2)} for meter ${meterNo}`
                });
            }

            session.startTransaction();

            const wallet = await Wallet.findOne({ user_id: req.user._id }).session(session);
            if (!wallet) {
                await session.abortTransaction(); session.endSession();
                return res.status(404).json({ ok: false, error: 'Wallet not found' });
            }
            if (wallet.status !== 'active') {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: `Wallet is not active (${wallet.status})` });
            }
            if (!wallet.hasSufficientBalance(parseFloat(amount))) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: `Insufficient balance. Available: ${wallet.formatted_balance}` });
            }

            const requestId = vtpassService.generateRequestId();
            const vtpassResponse = await vtpassService.buyElectricity(
                disco, meterNo, meterType, amount, phone || meterNo, requestId
            );

            if (!vtpassResponse.ok) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: vtpassError(vtpassResponse) });
            }

            await wallet.debit(parseFloat(amount), session);

            const vtpassData = vtpassResponse.data;
            const transactionId = vtpassData?.content?.transactions?.transactionId || requestId;
            const status = vtpassData?.content?.transactions?.status || 'delivered';
            const token = vtpassData?.content?.transactions?.token || vtpassData?.token;

            await Transaction.create([{
                user_id:   req.user._id,
                wallet_id: wallet._id,
                type:      'debit',
                provider:  'electricity',
                amount:    parseFloat(amount),
                currency:  'NGN',
                status:    status === 'delivered' ? 'success' : 'processing',
                reference: requestId,
                external_ref: transactionId,
                account_target: meterNo,
                details:   `${disco.toUpperCase()} electricity for meter ${meterNo}`,
                metadata: {
                    disco, meterNo, meterType, token,
                    vtpass_response: vtpassData,
                    request_id: requestId,
                    transaction_id: transactionId,
                    wallet_balance_before: wallet.balance + parseFloat(amount),
                    wallet_balance_after:  wallet.balance
                },
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }], { session });

            await session.commitTransaction();
            session.endSession();

            res.json({
                ok:          true,
                ref:         requestId,
                amount:      parseFloat(amount),
                disco:       disco.toUpperCase(),
                meterNo,
                meterType,
                token:       token || null,
                message:     `Electricity payment successful${token ? '. Token: ' + token : ''}`,
                new_balance: wallet.balance,
                status
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            logger.error('Pay electricity error:', error);
            res.status(500).json({ ok: false, error: error.message || 'Electricity payment failed' });
        }
    }

    /**
     * Verify meter / smartcard
     */
    async verifyCustomer(req, res) {
        const { provider, number, type } = req.query;

        if (!provider || !number) {
            return res.status(400).json({ ok: false, error: 'Provider and number are required' });
        }

        // Return a soft error when VTPass is not configured
        if (!vtpassService.isConfigured()) {
            return res.status(503).json({
                ok: false,
                error: 'Verification service is not available — provider credentials are not configured.'
            });
        }

        try {
            const serviceMap = {
                'dstv':      'dstv',
                'gotv':      'gotv',
                'startimes': 'startimes',
                'aedc':      'aedc',
                'ikedc':     'ikeja-electric',
                'ekedc':     'ekedc',
                'kedco':     'kedco',
                'phed':      'phed',
                'ibedc':     'ibedc',
                'eedc':      'eedc',
                'jed':       'jed'
            };

            const serviceID = serviceMap[provider.toLowerCase()] || provider;
            const response = await vtpassService.verify(serviceID, number, type || '');

            if (!response.ok || !response.data) {
                return res.status(400).json({
                    ok: false,
                    error: response.data?.response_description || 'Verification failed'
                });
            }

            const data = response.data;
            const customerName =
                data.customer_name    ||
                data.Customer_Name    ||
                data.content?.Customer_Name ||
                data.content?.customer_name ||
                null;

            if (!customerName) {
                return res.status(400).json({ ok: false, error: 'Could not verify — check the number and try again' });
            }

            res.json({
                ok: true,
                customerName,
                address:  data.address || data.content?.address || null,
                metadata: data
            });

        } catch (error) {
            logger.error('Verify customer error:', error);
            res.status(500).json({ ok: false, error: 'Verification failed' });
        }
    }
}

module.exports = new BillController();