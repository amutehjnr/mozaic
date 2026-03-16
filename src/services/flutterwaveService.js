const axios  = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class FlutterwaveService {
    constructor() {
        this.publicKey     = process.env.FLW_PUBLIC_KEY;
        this.secretKey     = process.env.FLW_SECRET_KEY;
        this.encryptionKey = process.env.FLW_ENCRYPTION_KEY;
        this.baseURL       = process.env.FLW_BASE_URL || 'https://api.flutterwave.com/v3';
        this.webhookSecret = process.env.FLW_WEBHOOK_SECRET;

        this.client = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Content-Type':  'application/json',
                'Accept':        'application/json',
                'Authorization': `Bearer ${this.secretKey}`
            },
            timeout: 30000
        });

        this.client.interceptors.request.use((config) => {
            logger.debug(`Flutterwave Request: ${config.method.toUpperCase()} ${config.url}`);
            return config;
        });

        this.client.interceptors.response.use(
            (response) => {
                logger.debug(`Flutterwave Response: ${response.status} ${response.config.url}`);
                return response;
            },
            (error) => {
                logger.error('Flutterwave API Error:', {
                    message:  error.message,
                    response: error.response?.data,
                    status:   error.response?.status,
                    url:      error.config?.url
                });
                return Promise.reject(error);
            }
        );
    }

    generateTxRef(prefix = 'FLW') {
        const timestamp = Date.now();
        const random    = crypto.randomBytes(8).toString('hex');
        return `${prefix}_${timestamp}_${random}`;
    }

    // ─── Low-level request helper ─────────────────────────────────────────────
    async makeRequest(endpoint, data, method = 'POST') {
        try {
            const config = { method, url: endpoint };
            if (method === 'POST' || method === 'PUT') config.data   = data;
            else                                        config.params = data;

            const response = await this.client(config);
            return { ok: true, data: response.data, status: response.status };
        } catch (error) {
            return {
                ok:     false,
                error:  error.message,
                data:   error.response?.data,
                status: error.response?.status
            };
        }
    }

    // ─── Payment initialisation ───────────────────────────────────────────────
    async initializePayment(data) {
        const payload = {
            tx_ref:          data.tx_ref || this.generateTxRef(),
            amount:          data.amount,
            currency:        data.currency  || 'NGN',
            redirect_url:    data.redirect_url,
            payment_options: data.payment_options || 'card,account,ussd,banktransfer',
            customer: {
                email:       data.customer.email,
                phonenumber: data.customer.phonenumber,
                name:        data.customer.name
            },
            customizations: {
                title:       data.customizations?.title       || 'MozAic Wallet Funding',
                description: data.customizations?.description || 'Fund your wallet',
                logo:        data.customizations?.logo
            },
            meta: data.meta || {}
        };

        if (data.payment_plan) payload.payment_plan = data.payment_plan;
        if (data.subaccounts)  payload.subaccounts  = data.subaccounts;

        return this.makeRequest('/payments', payload);
    }

    // ─── Transaction verification ─────────────────────────────────────────────

    /**
     * Verify a transaction by its Flutterwave numeric ID.
     * Endpoint: GET /transactions/:id/verify
     */
    async verifyTransaction(id) {
        return this.makeRequest(`/transactions/${id}/verify`, {}, 'GET');
    }

    /**
     * Look up a transaction by tx_ref.
     *
     * ⚠️  The endpoint GET /transactions/by_ref/:ref does NOT exist on the
     *     Flutterwave v3 API — it returns an HTML error page.
     *     The correct approach is GET /transactions?tx_ref=REF (list + filter).
     *
     * Returns the same {ok, data, status} envelope.
     * `data.data` will be the single matched transaction object or null.
     */
    async getTransactionByRef(txRef) {
        try {
            const response = await this.client.get('/transactions', {
                params: { tx_ref: txRef }
            });

            const items = response.data?.data;

            if (!Array.isArray(items) || items.length === 0) {
                // No matching transaction found
                return {
                    ok:     true,
                    data:   { status: 'success', message: 'No transaction found', data: null },
                    status: 200
                };
            }

            // Find the exact match (belt-and-suspenders — the filter is exact)
            const match = items.find(t => t.tx_ref === txRef) || items[0];

            return {
                ok:     true,
                data:   { status: 'success', message: 'Transaction fetched', data: match },
                status: 200
            };

        } catch (error) {
            logger.error('getTransactionByRef error:', error.message);
            return {
                ok:     false,
                error:  error.message,
                data:   error.response?.data,
                status: error.response?.status
            };
        }
    }

    // ─── Transfer methods ─────────────────────────────────────────────────────
    async initiateTransfer(data) {
        const payload = {
            account_bank:            data.account_bank,
            account_number:          data.account_number,
            amount:                  data.amount,
            narration:               data.narration || 'Wallet withdrawal',
            currency:                data.currency  || 'NGN',
            reference:               data.reference || this.generateTxRef('TRF'),
            beneficiary_name:        data.beneficiary_name,
            destination_branch_code: data.destination_branch_code
        };
        if (data.meta) payload.meta = data.meta;
        return this.makeRequest('/transfers', payload);
    }

    async getTransferStatus(id) {
        return this.makeRequest(`/transfers/${id}`, {}, 'GET');
    }

    async getBanks(country = 'NG') {
        return this.makeRequest(`/banks/${country}`, {}, 'GET');
    }

    async resolveAccount(account_number, account_bank) {
        return this.makeRequest('/accounts/resolve', { account_number, account_bank });
    }

    async getBalances(currency = null) {
        const endpoint = currency ? `/balances/${currency}` : '/balances';
        return this.makeRequest(endpoint, {}, 'GET');
    }

    // ─── Webhook signature verification ──────────────────────────────────────
    verifyWebhookSignature(signature, payload) {
        if (!this.webhookSecret) {
            logger.warn('FLW_WEBHOOK_SECRET not set — cannot verify webhook signature');
            return false;
        }

        // Flutterwave sends the secret directly in the verif-hash header
        // (not an HMAC — just a plain string comparison).
        return signature === this.webhookSecret;
    }
}

module.exports = new FlutterwaveService();