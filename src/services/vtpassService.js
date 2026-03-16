const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class VTPassService {
    constructor() {
        this.apiKey    = process.env.VTPASS_API_KEY;
        this.secretKey = process.env.VTPASS_SECRET_KEY;
        this.username  = process.env.VTPASS_USERNAME;
        this.password  = process.env.VTPASS_PASSWORD;
        this.sandbox   = process.env.VTPASS_SANDBOX === 'true';

        this.baseURL = this.sandbox
            ? 'https://sandbox.vtpass.com/api'
            : 'https://api.vtpass.com/api';

        // VTPass uses different auth per endpoint type:
        //   GET  (service-variations, merchant-verify) → api-key header
        //   POST (pay, requery)                        → Basic Auth (username/password)
        //                                                OR api-key + secret-key headers

        const commonHeaders = {
            'Content-Type': 'application/json',
            'Accept':       'application/json',
        };

        // GET client: api-key header only
        this.getClient = axios.create({
            baseURL: this.baseURL,
            headers: { ...commonHeaders, 'api-key': this.apiKey || '' },
            timeout: 30000,
        });

        // POST client: Basic Auth preferred; fall back to header-based auth
        this.postClient = axios.create({
            baseURL: this.baseURL,
            headers: {
                ...commonHeaders,
                // Header-based fallback (used when no username/password)
                'api-key':    this.apiKey    || '',
                'secret-key': this.secretKey || '',
            },
            // Basic Auth (takes priority when both are present)
            auth: (this.username && this.password)
                ? { username: this.username, password: this.password }
                : undefined,
            timeout: 30000,
        });

        // Attach logging interceptors to both clients
        [this.getClient, this.postClient].forEach(client => {
            client.interceptors.request.use(config => {
                logger.debug(`VTPass → ${config.method.toUpperCase()} ${config.baseURL}${config.url}`);
                return config;
            });
            client.interceptors.response.use(
                res => {
                    logger.debug(`VTPass ← ${res.status} ${res.config.url}`);
                    return res;
                },
                err => {
                    logger.error('VTPass API Error:', {
                        status:   err.response?.status,
                        message:  err.message,
                        url:      err.config?.url,
                        response: err.response?.data,
                    });
                    return Promise.reject(err);
                }
            );
        });
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    isConfigured() {
        return !!(this.apiKey || (this.username && this.password));
    }

    generateRequestId() {
        // VTPass requires a unique request_id; use timestamp + random hex
        const now  = new Date();
        const pad  = n => String(n).padStart(2, '0');
        const ts   =
            now.getFullYear() +
            pad(now.getMonth() + 1) +
            pad(now.getDate()) +
            pad(now.getHours()) +
            pad(now.getMinutes()) +
            pad(now.getSeconds());
        return ts + crypto.randomBytes(4).toString('hex').toUpperCase();
    }

    // ─── Low-level request wrappers ────────────────────────────────────────────

    /**
     * GET — uses api-key header client.
     * Never retried on 401/403.
     */
    async _get(endpoint, params = {}) {
        if (!this.isConfigured()) {
            return {
                ok: false,
                error: 'VTPass credentials not configured. Set VTPASS_API_KEY (and optionally VTPASS_SECRET_KEY).',
                status: 503,
            };
        }
        try {
            const res = await this.getClient.get(endpoint, { params });
            return { ok: true, data: res.data, status: res.status };
        } catch (err) {
            return this._handleError(err);
        }
    }

    /**
     * POST — uses Basic Auth (or header-based) client.
     * Retries up to 2× on transient failures; never retries 401/403.
     */
    async _post(endpoint, data, retries = 2) {
        if (!this.isConfigured()) {
            return {
                ok: false,
                error: 'VTPass credentials not configured. Set VTPASS_USERNAME + VTPASS_PASSWORD (or VTPASS_API_KEY + VTPASS_SECRET_KEY).',
                status: 503,
            };
        }
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const res = await this.postClient.post(endpoint, data);
                return { ok: true, data: res.data, status: res.status };
            } catch (err) {
                const status = err.response?.status;
                // Auth errors: fail immediately, retrying won't help
                if (status === 401 || status === 403) {
                    return this._handleError(err);
                }
                if (attempt === retries) {
                    return this._handleError(err);
                }
                // Exponential backoff for transient errors
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
            }
        }
    }

    _handleError(err) {
        const status = err.response?.status;
        let error = err.message;

        if (status === 401) {
            error = 'VTPass authentication failed. Check VTPASS_USERNAME / VTPASS_PASSWORD (or VTPASS_API_KEY).';
        } else if (status === 403) {
            error = 'VTPass access forbidden. Check your API key permissions.';
        }

        return {
            ok: false,
            error,
            data: err.response?.data,
            status,
        };
    }

    // ─── Public service methods ────────────────────────────────────────────────

    async getVariations(serviceID) {
        return this._get('/service-variations', { serviceID });
    }

    async verify(serviceID, billersCode, type = '') {
        return this._get('/merchant-verify', { serviceID, billersCode, type });
    }

    async pay(data) {
        const payload = { request_id: this.generateRequestId(), ...data };
        return this._post('/pay', payload);
    }

    async queryStatus(request_id, serviceID) {
        return this._post('/requery', { request_id, serviceID });
    }

    async getServices() {
        return this._get('/services');
    }

    async getCategories() {
        return this._get('/service-categories');
    }

    // ─── Bill helpers ──────────────────────────────────────────────────────────

    async buyAirtime(network, phone, amount, request_id = null) {
        const serviceMap = { mtn: 'mtn', glo: 'glo', airtel: 'airtel', '9mobile': 'etisalat' };
        const data = {
            serviceID: serviceMap[network.toLowerCase()] || network,
            amount:    String(amount),
            phone,
        };
        if (request_id) data.request_id = request_id;
        return this.pay(data);
    }

    async buyData(network, phone, plan, request_id = null) {
        const serviceMap = { mtn: 'mtn-data', glo: 'glo-data', airtel: 'airtel-data', '9mobile': 'etisalat-data' };
        const data = {
            serviceID:      serviceMap[network.toLowerCase()] || `${network}-data`,
            billersCode:    phone,
            variation_code: plan,
            phone,
        };
        if (request_id) data.request_id = request_id;
        return this.pay(data);
    }

    async getDataPlans(network) {
        const serviceMap = { mtn: 'mtn-data', glo: 'glo-data', airtel: 'airtel-data', '9mobile': 'etisalat-data' };
        const serviceID  = serviceMap[network.toLowerCase()] || `${network}-data`;
        const response   = await this.getVariations(serviceID);

        if (response.ok && response.data?.content) {
            return (response.data.content.variations || []).map(v => ({
                label:     v.name,
                code:      v.variation_code,
                amount:    parseFloat(v.variation_amount) || 0,
                serviceID,
            }));
        }
        return [];
    }

    async buyElectricity(disco, meterNo, meterType, amount, phone = '', request_id = null) {
        const serviceMap = {
            aedc: 'aedc', ikedc: 'ikeja-electric', ekedc: 'ekedc',
            kedco: 'kedco', phed: 'phed', ibedc: 'ibedc', eedc: 'eedc', jed: 'jed',
        };
        const data = {
            serviceID:      serviceMap[disco.toLowerCase()] || disco,
            billersCode:    meterNo,
            variation_code: meterType === 'prepaid' ? 'prepaid' : 'postpaid',
            amount:         String(amount),
            phone:          phone || meterNo,
        };
        if (request_id) data.request_id = request_id;
        return this.pay(data);
    }

    async buyTV(provider, smartcard, packageCode, phone = '', request_id = null) {
        const serviceMap = { dstv: 'dstv', gotv: 'gotv', startimes: 'startimes' };
        const data = {
            serviceID:      serviceMap[provider.toLowerCase()] || provider,
            billersCode:    smartcard,
            variation_code: packageCode,
            phone:          phone || smartcard,
        };
        if (request_id) data.request_id = request_id;
        return this.pay(data);
    }

    async getTVPackages(provider, smartcard = null) {
        const serviceMap = { dstv: 'dstv', gotv: 'gotv', startimes: 'startimes' };
        const serviceID  = serviceMap[provider.toLowerCase()] || provider;

        let customerName = null;
        if (smartcard) {
            const v = await this.verify(serviceID, smartcard);
            if (v.ok && v.data) {
                customerName =
                    v.data.customer_name         ||
                    v.data.Customer_Name         ||
                    v.data.content?.Customer_Name ||
                    null;
            }
        }

        const response = await this.getVariations(serviceID);
        if (response.ok && response.data?.content) {
            const packages = (response.data.content.variations || []).map(v => ({
                label:  v.name,
                code:   v.variation_code,
                amount: parseFloat(v.variation_amount) || 0,
                serviceID,
            }));
            return { ok: true, packages, customerName };
        }
        return { ok: false, packages: [], customerName: null };
    }

    async checkServiceStatus(serviceID) {
        const r = await this.getVariations(serviceID);
        return r.ok && !!r.data?.content;
    }
}

module.exports = new VTPassService();