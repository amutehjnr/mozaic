const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class FlutterwaveService {
    constructor() {
        this.publicKey = process.env.FLW_PUBLIC_KEY;
        this.secretKey = process.env.FLW_SECRET_KEY;
        this.encryptionKey = process.env.FLW_ENCRYPTION_KEY;
        this.baseURL = process.env.FLW_BASE_URL || 'https://api.flutterwave.com/v3';
        this.webhookSecret = process.env.FLW_WEBHOOK_SECRET;

        this.client = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${this.secretKey}`
            },
            timeout: 30000
        });

        // Request interceptor
        this.client.interceptors.request.use((config) => {
            logger.debug(`Flutterwave Request: ${config.method.toUpperCase()} ${config.url}`);
            return config;
        });

        // Response interceptor
        this.client.interceptors.response.use(
            (response) => {
                logger.debug(`Flutterwave Response: ${response.status} ${response.config.url}`);
                return response;
            },
            (error) => {
                logger.error('Flutterwave API Error:', {
                    message: error.message,
                    response: error.response?.data,
                    status: error.response?.status,
                    url: error.config?.url
                });
                return Promise.reject(error);
            }
        );
    }

    /**
     * Generate transaction reference
     */
    generateTxRef(prefix = 'FLW') {
        const timestamp = Date.now();
        const random = crypto.randomBytes(8).toString('hex');
        return `${prefix}_${timestamp}_${random}`;
    }

    /**
     * Make API request
     */
    async makeRequest(endpoint, data, method = 'POST') {
        try {
            const response = await this.client({
                method,
                url: endpoint,
                data: method === 'POST' ? data : undefined,
                params: method === 'GET' ? data : undefined
            });

            return {
                ok: true,
                data: response.data,
                status: response.status
            };
        } catch (error) {
            return {
                ok: false,
                error: error.message,
                data: error.response?.data,
                status: error.response?.status
            };
        }
    }

    /**
     * Initialize a payment
     */
    async initializePayment(data) {
        const endpoint = '/payments';
        
        const payload = {
            tx_ref: data.tx_ref || this.generateTxRef('FLW'),
            amount: data.amount,
            currency: data.currency || 'NGN',
            redirect_url: data.redirect_url,
            payment_options: data.payment_options || 'card,account,ussd,banktransfer',
            customer: {
                email: data.customer.email,
                phonenumber: data.customer.phonenumber,
                name: data.customer.name
            },
            customizations: {
                title: data.customizations?.title || 'MozAic Wallet Funding',
                description: data.customizations?.description || 'Fund your wallet',
                logo: data.customizations?.logo
            },
            meta: data.meta || {}
        };

        if (data.payment_plan) payload.payment_plan = data.payment_plan;
        if (data.subaccounts) payload.subaccounts = data.subaccounts;

        return await this.makeRequest(endpoint, payload);
    }

    /**
     * Verify a transaction
     */
    async verifyTransaction(id) {
        const endpoint = `/transactions/${id}/verify`;
        return await this.makeRequest(endpoint, {}, 'GET');
    }

    /**
     * Get transaction by reference
     */
    async getTransactionByRef(tx_ref) {
        const endpoint = `/transactions/by_ref/${tx_ref}`;
        return await this.makeRequest(endpoint, {}, 'GET');
    }

    /**
     * Create a payment link
     */
    async createPaymentLink(data) {
        const endpoint = '/payment-links';
        
        const payload = {
            tx_ref: data.tx_ref || this.generateTxRef('LINK'),
            amount: data.amount,
            currency: data.currency || 'NGN',
            title: data.title,
            description: data.description,
            logo: data.logo,
            duration: data.duration || '24hrs',
            payment_options: data.payment_options || 'card,account,ussd',
            redirect_url: data.redirect_url
        };

        return await this.makeRequest(endpoint, payload);
    }

    /**
     * Initiate a bank transfer
     */
    async initiateTransfer(data) {
        const endpoint = '/transfers';
        
        const payload = {
            account_bank: data.account_bank,
            account_number: data.account_number,
            amount: data.amount,
            narration: data.narration || 'Wallet withdrawal',
            currency: data.currency || 'NGN',
            reference: data.reference || this.generateTxRef('TRF'),
            beneficiary_name: data.beneficiary_name,
            destination_branch_code: data.destination_branch_code
        };

        if (data.meta) payload.meta = data.meta;

        return await this.makeRequest(endpoint, payload);
    }

    /**
     * Get transfer status
     */
    async getTransferStatus(id) {
        const endpoint = `/transfers/${id}`;
        return await this.makeRequest(endpoint, {}, 'GET');
    }

    /**
     * Get all transfers
     */
    async getTransfers(status = null, from = null, to = null) {
        const endpoint = '/transfers';
        const params = {};
        if (status) params.status = status;
        if (from) params.from = from;
        if (to) params.to = to;
        
        return await this.makeRequest(endpoint, params, 'GET');
    }

    /**
     * Get banks list
     */
    async getBanks(country = 'NG') {
        const endpoint = `/banks/${country}`;
        return await this.makeRequest(endpoint, {}, 'GET');
    }

    /**
     * Resolve account number
     */
    async resolveAccount(account_number, account_bank) {
        const endpoint = '/accounts/resolve';
        const data = {
            account_number,
            account_bank
        };
        return await this.makeRequest(endpoint, data);
    }

    /**
     * Get balances
     */
    async getBalances(currency = null) {
        const endpoint = currency ? `/balances/${currency}` : '/balances';
        return await this.makeRequest(endpoint, {}, 'GET');
    }

    /**
     * Initiate a bill payment
     */
    async payBill(data) {
        const endpoint = '/bills';
        
        const payload = {
            country: data.country || 'NG',
            customer: data.customer,
            amount: data.amount,
            recurrence: data.recurrence || 'ONCE',
            type: data.type,
            reference: data.reference || this.generateTxRef('BILL')
        };

        return await this.makeRequest(endpoint, payload);
    }

    /**
     * Get bill categories
     */
    async getBillCategories() {
        const endpoint = '/bill-categories';
        return await this.makeRequest(endpoint, {}, 'GET');
    }

    /**
     * Validate bill service
     */
    async validateBillService(item_code, customer) {
        const endpoint = '/bill-items';
        const data = {
            item_code,
            customer
        };
        return await this.makeRequest(endpoint, data);
    }

    /**
     * Create virtual account
     */
    async createVirtualAccount(data) {
        const endpoint = '/virtual-account-numbers';
        
        const payload = {
            email: data.email,
            is_permanent: data.is_permanent || true,
            bvn: data.bvn,
            tx_ref: data.tx_ref || this.generateTxRef('VA'),
            phonenumber: data.phonenumber,
            firstname: data.firstname,
            lastname: data.lastname,
            narration: data.narration || 'MozAic Wallet'
        };

        return await this.makeRequest(endpoint, payload);
    }

    /**
     * Verify webhook signature
     */
    verifyWebhookSignature(signature, payload) {
        if (!this.webhookSecret) return false;
        
        const hash = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(JSON.stringify(payload))
            .digest('hex');
        
        return signature === hash;
    }

    /**
     * Handle webhook event
     */
    async handleWebhook(payload) {
        const event = payload.event;
        const data = payload.data;

        logger.info(`Flutterwave Webhook: ${event}`, { tx_ref: data.tx_ref });

        switch (event) {
            case 'charge.completed':
                return await this.handleChargeCompleted(data);
            case 'transfer.completed':
                return await this.handleTransferCompleted(data);
            case 'subscription.cancelled':
                return await this.handleSubscriptionCancelled(data);
            default:
                logger.info(`Unhandled webhook event: ${event}`);
                return { received: true, event };
        }
    }

    /**
     * Handle charge completed webhook
     */
    async handleChargeCompleted(data) {
        const { tx_ref, id, amount, currency, customer, status } = data;
        
        // This will be called from the webhook route
        // We'll implement the business logic in the controller
        return {
            event: 'charge.completed',
            tx_ref,
            id,
            status
        };
    }

    /**
     * Handle transfer completed webhook
     */
    async handleTransferCompleted(data) {
        const { id, reference, amount, currency, status } = data;
        
        return {
            event: 'transfer.completed',
            id,
            reference,
            status
        };
    }

    /**
     * Handle subscription cancelled webhook
     */
    async handleSubscriptionCancelled(data) {
        const { id, reference, status } = data;
        
        return {
            event: 'subscription.cancelled',
            id,
            reference,
            status
        };
    }
}

module.exports = new FlutterwaveService();