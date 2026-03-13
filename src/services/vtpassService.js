const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class VTPassService {
    constructor() {
        this.apiKey = process.env.VTPASS_API_KEY;
        this.secretKey = process.env.VTPASS_SECRET_KEY;
        this.username = process.env.VTPASS_USERNAME;
        this.password = process.env.VTPASS_PASSWORD;
        this.sandbox = process.env.VTPASS_SANDBOX === 'true';
        
        this.baseURL = this.sandbox 
            ? 'https://sandbox.vtpass.com/api' 
            : 'https://api.vtpass.com/api';
        
        this.client = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'api-key': this.apiKey,
                'secret-key': this.secretKey,
                'public-key': this.apiKey
            },
            timeout: 30000 // 30 seconds
        });

        // Request interceptor for logging
        this.client.interceptors.request.use((config) => {
            logger.debug(`VTPass Request: ${config.method.toUpperCase()} ${config.url}`);
            return config;
        });

        // Response interceptor for logging
        this.client.interceptors.response.use(
            (response) => {
                logger.debug(`VTPass Response: ${response.status} ${response.config.url}`);
                return response;
            },
            (error) => {
                logger.error('VTPass API Error:', {
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
     * Generate request ID
     */
    generateRequestId() {
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        return `${timestamp}_${random}`;
    }

    /**
     * Make API request with retry logic
     */
    async makeRequest(endpoint, data, method = 'POST', retries = 2) {
        for (let i = 0; i <= retries; i++) {
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
                const isLastAttempt = i === retries;
                
                if (isLastAttempt) {
                    return {
                        ok: false,
                        error: error.message,
                        data: error.response?.data,
                        status: error.response?.status
                    };
                }

                // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
            }
        }
    }

    /**
     * Get service variations (plans)
     */
    async getVariations(serviceID) {
        const endpoint = '/service-variations';
        return await this.makeRequest(endpoint, { serviceID });
    }

    /**
     * Verify smartcard/meter number
     */
    async verify(serviceID, billersCode, type = '') {
        const endpoint = '/merchant-verify';
        const data = {
            serviceID,
            billersCode,
            type
        };
        return await this.makeRequest(endpoint, data);
    }

    /**
     * Make payment (purchase)
     */
    async pay(data) {
        const endpoint = '/pay';
        const payload = {
            request_id: this.generateRequestId(),
            ...data
        };
        return await this.makeRequest(endpoint, payload);
    }

    /**
     * Query transaction status
     */
    async queryStatus(request_id, serviceID) {
        const endpoint = '/requery';
        const data = {
            request_id,
            serviceID
        };
        return await this.makeRequest(endpoint, data);
    }

    /**
     * Get available services
     */
    async getServices() {
        const endpoint = '/services';
        return await this.makeRequest(endpoint, {}, 'GET');
    }

    /**
     * Get service categories
     */
    async getCategories() {
        const endpoint = '/service-categories';
        return await this.makeRequest(endpoint, {}, 'GET');
    }

    /**
     * Get transaction history
     */
    async getTransactionHistory(serviceID = null, startDate = null, endDate = null) {
        const endpoint = '/transactions';
        const params = {};
        if (serviceID) params.serviceID = serviceID;
        if (startDate) params.startDate = startDate;
        if (endDate) params.endDate = endDate;
        
        return await this.makeRequest(endpoint, params, 'GET');
    }

    // ================ Specific Service Methods ================

    /**
     * Buy airtime
     */
    async buyAirtime(network, phone, amount, request_id = null) {
        const serviceMap = {
            'mtn': 'mtn',
            'glo': 'glo',
            'airtel': 'airtel',
            '9mobile': 'etisalat'
        };

        const serviceID = serviceMap[network.toLowerCase()] || network;
        
        const data = {
            serviceID,
            amount: amount.toString(),
            phone
        };

        if (request_id) data.request_id = request_id;

        return await this.pay(data);
    }

    /**
     * Buy data
     */
    async buyData(network, phone, plan, request_id = null) {
        const serviceMap = {
            'mtn': 'mtn-data',
            'glo': 'glo-data',
            'airtel': 'airtel-data',
            '9mobile': 'etisalat-data'
        };

        const serviceID = serviceMap[network.toLowerCase()] || `${network}-data`;
        
        const data = {
            serviceID,
            billersCode: phone,
            variation_code: plan,
            phone
        };

        if (request_id) data.request_id = request_id;

        return await this.pay(data);
    }

    /**
     * Get data plans
     */
    async getDataPlans(network) {
        const serviceMap = {
            'mtn': 'mtn-data',
            'glo': 'glo-data',
            'airtel': 'airtel-data',
            '9mobile': 'etisalat-data'
        };

        const serviceID = serviceMap[network.toLowerCase()] || `${network}-data`;
        
        const response = await this.getVariations(serviceID);
        
        if (response.ok && response.data && response.data.content) {
            const variations = response.data.content.variations || [];
            return variations.map(v => ({
                label: v.name,
                code: v.variation_code,
                amount: parseFloat(v.variation_amount) || 0,
                serviceID
            }));
        }
        
        return [];
    }

    /**
     * Buy electricity
     */
    async buyElectricity(disco, meterNo, meterType, amount, phone = '', request_id = null) {
        const serviceMap = {
            'aedc': 'aedc',
            'ikedc': 'ikeja-electric',
            'ekedc': 'ekedc',
            'kedco': 'kedco'
        };

        const serviceID = serviceMap[disco.toLowerCase()] || disco;
        
        const data = {
            serviceID,
            billersCode: meterNo,
            variation_code: meterType === 'prepaid' ? 'prepaid' : 'postpaid',
            amount: amount.toString(),
            phone: phone || meterNo
        };

        if (request_id) data.request_id = request_id;

        return await this.pay(data);
    }

    /**
     * Buy TV subscription
     */
    async buyTV(provider, smartcard, packageCode, phone = '', request_id = null) {
        const serviceMap = {
            'dstv': 'dstv',
            'gotv': 'gotv',
            'startimes': 'startimes'
        };

        const serviceID = serviceMap[provider.toLowerCase()] || provider;
        
        const data = {
            serviceID,
            billersCode: smartcard,
            variation_code: packageCode,
            phone: phone || smartcard
        };

        if (request_id) data.request_id = request_id;

        return await this.pay(data);
    }

    /**
     * Get TV packages
     */
    async getTVPackages(provider, smartcard = null) {
        const serviceMap = {
            'dstv': 'dstv',
            'gotv': 'gotv',
            'startimes': 'startimes'
        };

        const serviceID = serviceMap[provider.toLowerCase()] || provider;
        
        // First verify smartcard if provided
        let customerName = null;
        if (smartcard) {
            const verifyResponse = await this.verify(serviceID, smartcard);
            if (verifyResponse.ok && verifyResponse.data) {
                customerName = verifyResponse.data.customer_name || 
                              verifyResponse.data.Customer_Name || 
                              verifyResponse.data.content?.Customer_Name;
            }
        }
        
        // Get packages
        const response = await this.getVariations(serviceID);
        
        if (response.ok && response.data && response.data.content) {
            const variations = response.data.content.variations || [];
            const packages = variations.map(v => ({
                label: v.name,
                code: v.variation_code,
                amount: parseFloat(v.variation_amount) || 0,
                serviceID
            }));
            
            return {
                ok: true,
                packages,
                customerName
            };
        }
        
        return {
            ok: false,
            packages: [],
            customerName: null
        };
    }

    /**
     * Check if service is available
     */
    async checkServiceStatus(serviceID) {
        const response = await this.getVariations(serviceID);
        return response.ok && response.data && response.data.content;
    }
}

module.exports = new VTPassService();