const Transaction = require('../models/Transaction');
const Wallet      = require('../models/Wallet');
const Beneficiary = require('../models/Beneficiary');
const vtpassService = require('../services/vtpassService');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const logger   = require('../utils/logger');

/** Extract a human-readable message from a VTPass failure response. */
function vtpassError(response) {
    const d = response?.data;
    return (
        d?.response_description ||
        d?.error                ||
        d?.message              ||
        response?.error         ||
        'Payment provider request failed'
    );
}

/** Shared "service not ready" reply. */
function notConfigured(res) {
    return res.status(503).json({
        ok: false,
        error: 'This service is temporarily unavailable — provider credentials are not configured. Please contact support.',
    });
}

class BillController {

    // ─── Data plans (public) ───────────────────────────────────────────────────
    async getDataPlans(req, res) {
        const { network } = req.query;
        if (!network) return res.status(400).json({ ok: false, error: 'Network is required' });

        if (!vtpassService.isConfigured()) return res.json([]);

        try {
            const plans = await vtpassService.getDataPlans(network);
            res.json(Array.isArray(plans) ? plans : []);
        } catch (err) {
            logger.error('Get data plans error:', err);
            res.status(500).json({ ok: false, error: 'Failed to fetch data plans' });
        }
    }

    // ─── Buy data ──────────────────────────────────────────────────────────────
    async buyData(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: errors.array()[0].msg });
        if (!vtpassService.isConfigured()) return notConfigured(res);

        const { network, phone, planCode, amount, confirm } = req.body;

        if (!confirm || confirm === 'false' || confirm === '0') {
            return res.json({
                ok: true, preview: true,
                network: network.toUpperCase(), plan: planCode, phone,
                amount: parseFloat(amount), fees: 0, total: parseFloat(amount),
                message: `Confirm purchase of ${network.toUpperCase()} data (${planCode}) for ${phone}`,
            });
        }

        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const wallet = await Wallet.findOne({ user_id: req.user._id }).session(session);
            if (!wallet) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ ok: false, error: 'Wallet not found' }); }
            if (wallet.status !== 'active') { await session.abortTransaction(); session.endSession(); return res.status(400).json({ ok: false, error: `Wallet is not active (${wallet.status})` }); }
            if (!wallet.hasSufficientBalance(parseFloat(amount))) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ ok: false, error: `Insufficient balance. Available: ${wallet.formatted_balance}` }); }

            const requestId      = vtpassService.generateRequestId();
            const vtpassResponse = await vtpassService.buyData(network, phone, planCode, requestId);

            if (!vtpassResponse.ok) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: vtpassError(vtpassResponse) });
            }

            await wallet.debit(parseFloat(amount), session);

            const vd     = vtpassResponse.data;
            const txId   = vd?.content?.transactions?.transactionId || requestId;
            const status = vd?.content?.transactions?.status || 'delivered';

            await Transaction.create([{
                user_id: req.user._id, wallet_id: wallet._id,
                type: 'debit', provider: 'data',
                amount: parseFloat(amount), currency: 'NGN',
                status: status === 'delivered' ? 'success' : 'processing',
                reference: requestId, external_ref: txId,
                account_target: phone, plan_code: planCode,
                details: `${network.toUpperCase()} data for ${phone}`,
                metadata: { network, plan: planCode, phone, vtpass_response: vd, request_id: requestId,
                    wallet_balance_before: wallet.balance + parseFloat(amount), wallet_balance_after: wallet.balance },
                ip_address: req.ip, user_agent: req.headers['user-agent'],
            }], { session });

            if (req.body.saveBeneficiary && req.body.saveBeneficiary !== '0') {
                await Beneficiary.create([{
                    user_id: req.user._id, type: 'data',
                    label: `${network.toUpperCase()} — ${phone}`, value: phone,
                    provider: network, metadata: { network, plan: planCode },
                }], { session }).catch(() => {});
            }

            await session.commitTransaction(); session.endSession();
            res.json({ ok: true, ref: requestId, amount: parseFloat(amount), network: network.toUpperCase(), phone, plan: planCode, message: 'Data purchase successful', new_balance: wallet.balance, status });

        } catch (err) {
            await session.abortTransaction(); session.endSession();
            logger.error('Buy data error:', err);
            res.status(500).json({ ok: false, error: err.message || 'Data purchase failed' });
        }
    }

    // ─── Buy airtime ───────────────────────────────────────────────────────────
    async buyAirtime(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: errors.array()[0].msg });
        if (!vtpassService.isConfigured()) return notConfigured(res);

        const { network, phone, amount, confirm } = req.body;

        if (!confirm || confirm === 'false' || confirm === '0') {
            return res.json({
                ok: true, preview: true,
                network: network.toUpperCase(), phone,
                amount: parseFloat(amount), fees: 0, total: parseFloat(amount),
                message: `Confirm airtime purchase of ₦${parseFloat(amount).toFixed(2)} for ${phone}`,
            });
        }

        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const wallet = await Wallet.findOne({ user_id: req.user._id }).session(session);
            if (!wallet) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ ok: false, error: 'Wallet not found' }); }
            if (wallet.status !== 'active') { await session.abortTransaction(); session.endSession(); return res.status(400).json({ ok: false, error: `Wallet is not active (${wallet.status})` }); }
            if (!wallet.hasSufficientBalance(parseFloat(amount))) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ ok: false, error: `Insufficient balance. Available: ${wallet.formatted_balance}` }); }

            const requestId      = vtpassService.generateRequestId();
            const vtpassResponse = await vtpassService.buyAirtime(network, phone, amount, requestId);

            if (!vtpassResponse.ok) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: vtpassError(vtpassResponse) });
            }

            await wallet.debit(parseFloat(amount), session);

            const vd     = vtpassResponse.data;
            const txId   = vd?.content?.transactions?.transactionId || requestId;
            const status = vd?.content?.transactions?.status || 'delivered';

            await Transaction.create([{
                user_id: req.user._id, wallet_id: wallet._id,
                type: 'debit', provider: 'airtime',
                amount: parseFloat(amount), currency: 'NGN',
                status: status === 'delivered' ? 'success' : 'processing',
                reference: requestId, external_ref: txId,
                account_target: phone,
                details: `${network.toUpperCase()} airtime for ${phone}`,
                metadata: { network, phone, amount, vtpass_response: vd, request_id: requestId,
                    wallet_balance_before: wallet.balance + parseFloat(amount), wallet_balance_after: wallet.balance },
                ip_address: req.ip, user_agent: req.headers['user-agent'],
            }], { session });

            if (req.body.saveBeneficiary && req.body.saveBeneficiary !== '0') {
                await Beneficiary.create([{
                    user_id: req.user._id, type: 'airtime',
                    label: `${network.toUpperCase()} — ${phone}`, value: phone, provider: network,
                }], { session }).catch(() => {});
            }

            await session.commitTransaction(); session.endSession();
            res.json({ ok: true, ref: requestId, amount: parseFloat(amount), network: network.toUpperCase(), phone, message: 'Airtime purchase successful', new_balance: wallet.balance, status });

        } catch (err) {
            await session.abortTransaction(); session.endSession();
            logger.error('Buy airtime error:', err);
            res.status(500).json({ ok: false, error: err.message || 'Airtime purchase failed' });
        }
    }

    // ─── TV packages (public) ──────────────────────────────────────────────────
    async getTVPackages(req, res) {
        const { provider, smartcard } = req.query;
        if (!provider) return res.status(400).json({ ok: false, error: 'Provider is required' });
        if (!vtpassService.isConfigured()) return res.json({ ok: true, packages: [], customerName: null, smartcard });

        try {
            const result = await vtpassService.getTVPackages(provider, smartcard);
            res.json({ ok: true, packages: result.packages || [], customerName: result.customerName || null, smartcard });
        } catch (err) {
            logger.error('Get TV packages error:', err);
            res.status(500).json({ ok: false, error: 'Failed to fetch TV packages' });
        }
    }

    // ─── Buy TV ────────────────────────────────────────────────────────────────
    async buyTV(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: errors.array()[0].msg });
        if (!vtpassService.isConfigured()) return notConfigured(res);

        const { provider, card, package: packageCode, amount, phone, confirm } = req.body;

        if (!confirm || confirm === 'false' || confirm === '0') {
            return res.json({
                ok: true, preview: true,
                provider: provider.toUpperCase(), package: packageCode, smartcard: card,
                amount: parseFloat(amount), fees: 0, total: parseFloat(amount),
                message: `Confirm ${provider.toUpperCase()} subscription of ₦${parseFloat(amount).toFixed(2)} for ${card}`,
            });
        }

        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const wallet = await Wallet.findOne({ user_id: req.user._id }).session(session);
            if (!wallet) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ ok: false, error: 'Wallet not found' }); }
            if (wallet.status !== 'active') { await session.abortTransaction(); session.endSession(); return res.status(400).json({ ok: false, error: `Wallet is not active (${wallet.status})` }); }
            if (!wallet.hasSufficientBalance(parseFloat(amount))) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ ok: false, error: `Insufficient balance. Available: ${wallet.formatted_balance}` }); }

            const requestId      = vtpassService.generateRequestId();
            const vtpassResponse = await vtpassService.buyTV(provider, card, packageCode, phone || card, requestId);

            if (!vtpassResponse.ok) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: vtpassError(vtpassResponse) });
            }

            await wallet.debit(parseFloat(amount), session);

            const vd     = vtpassResponse.data;
            const txId   = vd?.content?.transactions?.transactionId || requestId;
            const status = vd?.content?.transactions?.status || 'delivered';

            await Transaction.create([{
                user_id: req.user._id, wallet_id: wallet._id,
                type: 'debit', provider: 'tv',
                amount: parseFloat(amount), currency: 'NGN',
                status: status === 'delivered' ? 'success' : 'processing',
                reference: requestId, external_ref: txId,
                account_target: card, plan_code: packageCode,
                details: `${provider.toUpperCase()} subscription for ${card}`,
                metadata: { provider, package: packageCode, smartcard: card, vtpass_response: vd,
                    request_id: requestId, wallet_balance_before: wallet.balance + parseFloat(amount), wallet_balance_after: wallet.balance },
                ip_address: req.ip, user_agent: req.headers['user-agent'],
            }], { session });

            await session.commitTransaction(); session.endSession();
            res.json({ ok: true, ref: requestId, amount: parseFloat(amount), provider: provider.toUpperCase(), smartcard: card, package: packageCode, message: 'TV subscription successful', new_balance: wallet.balance, status });

        } catch (err) {
            await session.abortTransaction(); session.endSession();
            logger.error('Buy TV error:', err);
            res.status(500).json({ ok: false, error: err.message || 'TV subscription failed' });
        }
    }

    // ─── Pay electricity ───────────────────────────────────────────────────────
    async payElectricity(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(422).json({ ok: false, error: errors.array()[0].msg });
        if (!vtpassService.isConfigured()) return notConfigured(res);

        const { disco, meterNo, meterType, amount, phone, confirm } = req.body;

        if (!confirm || confirm === 'false' || confirm === '0') {
            return res.json({
                ok: true, preview: true,
                disco: disco.toUpperCase(), meterNo, meterType,
                amount: parseFloat(amount), fees: 0, total: parseFloat(amount),
                message: `Confirm electricity payment of ₦${parseFloat(amount).toFixed(2)} for meter ${meterNo}`,
            });
        }

        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const wallet = await Wallet.findOne({ user_id: req.user._id }).session(session);
            if (!wallet) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ ok: false, error: 'Wallet not found' }); }
            if (wallet.status !== 'active') { await session.abortTransaction(); session.endSession(); return res.status(400).json({ ok: false, error: `Wallet is not active (${wallet.status})` }); }
            if (!wallet.hasSufficientBalance(parseFloat(amount))) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ ok: false, error: `Insufficient balance. Available: ${wallet.formatted_balance}` }); }

            const requestId      = vtpassService.generateRequestId();
            const vtpassResponse = await vtpassService.buyElectricity(disco, meterNo, meterType, amount, phone || meterNo, requestId);

            if (!vtpassResponse.ok) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ ok: false, error: vtpassError(vtpassResponse) });
            }

            await wallet.debit(parseFloat(amount), session);

            const vd     = vtpassResponse.data;
            const txId   = vd?.content?.transactions?.transactionId || requestId;
            const status = vd?.content?.transactions?.status || 'delivered';
            const token  = vd?.content?.transactions?.token || vd?.token;

            await Transaction.create([{
                user_id: req.user._id, wallet_id: wallet._id,
                type: 'debit', provider: 'electricity',
                amount: parseFloat(amount), currency: 'NGN',
                status: status === 'delivered' ? 'success' : 'processing',
                reference: requestId, external_ref: txId,
                account_target: meterNo,
                details: `${disco.toUpperCase()} electricity for meter ${meterNo}`,
                metadata: { disco, meterNo, meterType, token, vtpass_response: vd, request_id: requestId,
                    wallet_balance_before: wallet.balance + parseFloat(amount), wallet_balance_after: wallet.balance },
                ip_address: req.ip, user_agent: req.headers['user-agent'],
            }], { session });

            await session.commitTransaction(); session.endSession();
            res.json({ ok: true, ref: requestId, amount: parseFloat(amount), disco: disco.toUpperCase(), meterNo, meterType, token: token || null, message: `Electricity payment successful${token ? '. Token: ' + token : ''}`, new_balance: wallet.balance, status });

        } catch (err) {
            await session.abortTransaction(); session.endSession();
            logger.error('Pay electricity error:', err);
            res.status(500).json({ ok: false, error: err.message || 'Electricity payment failed' });
        }
    }

    // ─── Verify customer (public) ──────────────────────────────────────────────
    async verifyCustomer(req, res) {
        const { provider, number, type } = req.query;
        if (!provider || !number) return res.status(400).json({ ok: false, error: 'Provider and number are required' });
        if (!vtpassService.isConfigured()) return res.status(503).json({ ok: false, error: 'Verification service not available — provider credentials not configured.' });

        try {
            const serviceMap = {
                dstv: 'dstv', gotv: 'gotv', startimes: 'startimes',
                aedc: 'aedc', ikedc: 'ikeja-electric', ekedc: 'ekedc',
                kedco: 'kedco', phed: 'phed', ibedc: 'ibedc', eedc: 'eedc', jed: 'jed',
            };
            const serviceID = serviceMap[provider.toLowerCase()] || provider;
            const response  = await vtpassService.verify(serviceID, number, type || '');

            if (!response.ok || !response.data) {
                return res.status(400).json({ ok: false, error: response.data?.response_description || 'Verification failed' });
            }

            const data         = response.data;
            const customerName =
                data.customer_name         ||
                data.Customer_Name         ||
                data.content?.Customer_Name ||
                data.content?.customer_name ||
                null;

            if (!customerName) return res.status(400).json({ ok: false, error: 'Could not verify — check the number and try again' });

            res.json({ ok: true, customerName, address: data.address || data.content?.address || null, metadata: data });

        } catch (err) {
            logger.error('Verify customer error:', err);
            res.status(500).json({ ok: false, error: 'Verification failed' });
        }
    }
}

module.exports = new BillController();