const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const Beneficiary = require('../models/Beneficiary');
const vtpassService = require('../services/vtpassService');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

class BillController {
    /**
     * Get data plans
     */
    async getDataPlans(req, res) {
        const { network } = req.query;

        if (!network) {
            return res.status(400).json({
                ok: false,
                error: 'Network is required'
            });
        }

        try {
            const plans = await vtpassService.getDataPlans(network);

            res.json(plans);
        } catch (error) {
            logger.error('Get data plans error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to fetch data plans'
            });
        }
    }

    /**
     * Buy data
     */
    async buyData(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                ok: false,
                error: errors.array()[0].msg
            });
        }

        const { network, phone, planCode, amount, confirm } = req.body;
        const session = await mongoose.startSession();

        try {
            // Preview mode
            if (!confirm) {
                return res.json({
                    ok: true,
                    preview: true,
                    network: network.toUpperCase(),
                    plan: planCode,
                    phone,
                    amount: parseFloat(amount),
                    fees: 0,
                    total: parseFloat(amount),
                    message: `Confirm purchase of ₦${parseFloat(amount).toFixed(2)} data for ${phone}`
                });
            }

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

            // Generate request ID
            const requestId = vtpassService.generateRequestId();

            // Call VTPass API
            const vtpassResponse = await vtpassService.buyData(
                network,
                phone,
                planCode,
                requestId
            );

            if (!vtpassResponse.ok) {
                const errorMsg = vtpassResponse.data?.response_description || 
                                vtpassResponse.data?.error || 
                                'VTPass payment failed';
                throw new Error(errorMsg);
            }

            // Debit wallet
            await wallet.debit(parseFloat(amount), session);

            // Parse VTPass response
            const vtpassData = vtpassResponse.data;
            const transactionId = vtpassData?.content?.transactions?.transactionId || requestId;
            const status = vtpassData?.content?.transactions?.status || 'delivered';

            // Save transaction
            const transaction = await Transaction.create([{
                user_id: req.user._id,
                wallet_id: wallet._id,
                type: 'debit',
                provider: 'data',
                amount: parseFloat(amount),
                currency: 'NGN',
                status: status === 'delivered' ? 'success' : 'processing',
                reference: requestId,
                external_ref: transactionId,
                account_target: phone,
                plan_code: planCode,
                details: `${network.toUpperCase()} data purchase for ${phone}`,
                metadata: {
                    network,
                    plan: planCode,
                    phone,
                    vtpass_response: vtpassData,
                    request_id: requestId,
                    transaction_id: transactionId,
                    wallet_balance_before: wallet.balance + parseFloat(amount),
                    wallet_balance_after: wallet.balance
                },
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }], { session });

            // Save as beneficiary if requested
            if (req.body.saveBeneficiary) {
                await Beneficiary.create([{
                    user_id: req.user._id,
                    type: 'data',
                    label: req.body.beneficiaryLabel || `${network.toUpperCase()} - ${phone}`,
                    value: phone,
                    provider: network,
                    metadata: { network, plan: planCode }
                }], { session });
            }

            await session.commitTransaction();
            session.endSession();

            res.json({
                ok: true,
                ref: requestId,
                amount: parseFloat(amount),
                network: network.toUpperCase(),
                phone,
                plan: planCode,
                message: 'Data purchase successful',
                new_balance: wallet.balance,
                status
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            
            logger.error('Buy data error:', error);
            res.status(500).json({
                ok: false,
                error: error.message || 'Data purchase failed'
            });
        }
    }

    /**
     * Buy airtime
     */
    async buyAirtime(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                ok: false,
                error: errors.array()[0].msg
            });
        }

        const { network, phone, amount, confirm } = req.body;
        const session = await mongoose.startSession();

        try {
            // Preview mode
            if (!confirm) {
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

            // Generate request ID
            const requestId = vtpassService.generateRequestId();

            // Call VTPass API
            const vtpassResponse = await vtpassService.buyAirtime(
                network,
                phone,
                amount,
                requestId
            );

            if (!vtpassResponse.ok) {
                const errorMsg = vtpassResponse.data?.response_description || 
                                vtpassResponse.data?.error || 
                                'VTPass payment failed';
                throw new Error(errorMsg);
            }

            // Debit wallet
            await wallet.debit(parseFloat(amount), session);

            // Parse VTPass response
            const vtpassData = vtpassResponse.data;
            const transactionId = vtpassData?.content?.transactions?.transactionId || requestId;
            const status = vtpassData?.content?.transactions?.status || 'delivered';

            // Save transaction
            const transaction = await Transaction.create([{
                user_id: req.user._id,
                wallet_id: wallet._id,
                type: 'debit',
                provider: 'airtime',
                amount: parseFloat(amount),
                currency: 'NGN',
                status: status === 'delivered' ? 'success' : 'processing',
                reference: requestId,
                external_ref: transactionId,
                account_target: phone,
                details: `${network.toUpperCase()} airtime purchase for ${phone}`,
                metadata: {
                    network,
                    phone,
                    amount,
                    vtpass_response: vtpassData,
                    request_id: requestId,
                    transaction_id: transactionId,
                    wallet_balance_before: wallet.balance + parseFloat(amount),
                    wallet_balance_after: wallet.balance
                },
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }], { session });

            // Save as beneficiary if requested
            if (req.body.saveBeneficiary) {
                await Beneficiary.create([{
                    user_id: req.user._id,
                    type: 'airtime',
                    label: req.body.beneficiaryLabel || `${network.toUpperCase()} - ${phone}`,
                    value: phone,
                    provider: network
                }], { session });
            }

            await session.commitTransaction();
            session.endSession();

            res.json({
                ok: true,
                ref: requestId,
                amount: parseFloat(amount),
                network: network.toUpperCase(),
                phone,
                message: 'Airtime purchase successful',
                new_balance: wallet.balance,
                status
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            
            logger.error('Buy airtime error:', error);
            res.status(500).json({
                ok: false,
                error: error.message || 'Airtime purchase failed'
            });
        }
    }

    /**
     * Get TV packages
     */
    async getTVPackages(req, res) {
        const { provider, smartcard } = req.query;

        if (!provider) {
            return res.status(400).json({
                ok: false,
                error: 'Provider is required'
            });
        }

        try {
            const result = await vtpassService.getTVPackages(provider, smartcard);

            res.json({
                ok: true,
                packages: result.packages,
                customerName: result.customerName,
                smartcard
            });
        } catch (error) {
            logger.error('Get TV packages error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to fetch TV packages'
            });
        }
    }

    /**
     * Buy TV subscription
     */
    async buyTV(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                ok: false,
                error: errors.array()[0].msg
            });
        }

        const { provider, card, package: packageCode, amount, phone, confirm } = req.body;
        const session = await mongoose.startSession();

        try {
            // Preview mode
            if (!confirm) {
                return res.json({
                    ok: true,
                    preview: true,
                    provider: provider.toUpperCase(),
                    package: packageCode,
                    smartcard: card,
                    amount: parseFloat(amount),
                    fees: 0,
                    total: parseFloat(amount),
                    message: `Confirm TV subscription of ₦${parseFloat(amount).toFixed(2)} for ${card}`
                });
            }

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

            // Generate request ID
            const requestId = vtpassService.generateRequestId();

            // Call VTPass API
            const vtpassResponse = await vtpassService.buyTV(
                provider,
                card,
                packageCode,
                phone || card,
                requestId
            );

            if (!vtpassResponse.ok) {
                const errorMsg = vtpassResponse.data?.response_description || 
                                vtpassResponse.data?.error || 
                                'VTPass payment failed';
                throw new Error(errorMsg);
            }

            // Debit wallet
            await wallet.debit(parseFloat(amount), session);

            // Parse VTPass response
            const vtpassData = vtpassResponse.data;
            const transactionId = vtpassData?.content?.transactions?.transactionId || requestId;
            const status = vtpassData?.content?.transactions?.status || 'delivered';

            // Save transaction
            const transaction = await Transaction.create([{
                user_id: req.user._id,
                wallet_id: wallet._id,
                type: 'debit',
                provider: 'tv',
                amount: parseFloat(amount),
                currency: 'NGN',
                status: status === 'delivered' ? 'success' : 'processing',
                reference: requestId,
                external_ref: transactionId,
                account_target: card,
                plan_code: packageCode,
                details: `${provider.toUpperCase()} subscription for ${card}`,
                metadata: {
                    provider,
                    package: packageCode,
                    smartcard: card,
                    vtpass_response: vtpassData,
                    request_id: requestId,
                    transaction_id: transactionId,
                    wallet_balance_before: wallet.balance + parseFloat(amount),
                    wallet_balance_after: wallet.balance
                },
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }], { session });

            // Save as beneficiary if requested
            if (req.body.saveBeneficiary) {
                await Beneficiary.create([{
                    user_id: req.user._id,
                    type: 'tv',
                    label: req.body.beneficiaryLabel || `${provider.toUpperCase()} - ${card}`,
                    value: card,
                    provider,
                    metadata: { package: packageCode }
                }], { session });
            }

            await session.commitTransaction();
            session.endSession();

            res.json({
                ok: true,
                ref: requestId,
                amount: parseFloat(amount),
                provider: provider.toUpperCase(),
                smartcard: card,
                package: packageCode,
                message: 'TV subscription successful',
                new_balance: wallet.balance,
                status
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            
            logger.error('Buy TV error:', error);
            res.status(500).json({
                ok: false,
                error: error.message || 'TV subscription failed'
            });
        }
    }

    /**
     * Pay electricity
     */
    async payElectricity(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                ok: false,
                error: errors.array()[0].msg
            });
        }

        const { disco, meterNo, meterType, amount, phone, confirm } = req.body;
        const session = await mongoose.startSession();

        try {
            // Preview mode
            if (!confirm) {
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

            // Generate request ID
            const requestId = vtpassService.generateRequestId();

            // Call VTPass API
            const vtpassResponse = await vtpassService.buyElectricity(
                disco,
                meterNo,
                meterType,
                amount,
                phone || meterNo,
                requestId
            );

            if (!vtpassResponse.ok) {
                const errorMsg = vtpassResponse.data?.response_description || 
                                vtpassResponse.data?.error || 
                                'VTPass payment failed';
                throw new Error(errorMsg);
            }

            // Debit wallet
            await wallet.debit(parseFloat(amount), session);

            // Parse VTPass response
            const vtpassData = vtpassResponse.data;
            const transactionId = vtpassData?.content?.transactions?.transactionId || requestId;
            const status = vtpassData?.content?.transactions?.status || 'delivered';

            // Save transaction
            const transaction = await Transaction.create([{
                user_id: req.user._id,
                wallet_id: wallet._id,
                type: 'debit',
                provider: 'electricity',
                amount: parseFloat(amount),
                currency: 'NGN',
                status: status === 'delivered' ? 'success' : 'processing',
                reference: requestId,
                external_ref: transactionId,
                account_target: meterNo,
                details: `${disco.toUpperCase()} electricity payment for meter ${meterNo}`,
                metadata: {
                    disco,
                    meterNo,
                    meterType,
                    vtpass_response: vtpassData,
                    request_id: requestId,
                    transaction_id: transactionId,
                    wallet_balance_before: wallet.balance + parseFloat(amount),
                    wallet_balance_after: wallet.balance
                },
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }], { session });

            await session.commitTransaction();
            session.endSession();

            res.json({
                ok: true,
                ref: requestId,
                amount: parseFloat(amount),
                disco: disco.toUpperCase(),
                meterNo,
                meterType,
                message: 'Electricity payment successful',
                new_balance: wallet.balance,
                status
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            
            logger.error('Pay electricity error:', error);
            res.status(500).json({
                ok: false,
                error: error.message || 'Electricity payment failed'
            });
        }
    }

    /**
     * Verify meter/smartcard
     */
    async verifyCustomer(req, res) {
        const { provider, number, type } = req.query;

        if (!provider || !number) {
            return res.status(400).json({
                ok: false,
                error: 'Provider and number are required'
            });
        }

        try {
            const serviceMap = {
                'dstv': 'dstv',
                'gotv': 'gotv',
                'startimes': 'startimes',
                'aedc': 'aedc',
                'ikedc': 'ikeja-electric',
                'ekedc': 'ekedc',
                'kedco': 'kedco'
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
            const customerName = data.customer_name || 
                                data.Customer_Name || 
                                data.content?.Customer_Name ||
                                data.content?.customer_name ||
                                'Customer';

            res.json({
                ok: true,
                customerName,
                address: data.address || data.content?.address,
                metadata: data
            });

        } catch (error) {
            logger.error('Verify customer error:', error);
            res.status(500).json({
                ok: false,
                error: 'Verification failed'
            });
        }
    }
}

module.exports = new BillController();