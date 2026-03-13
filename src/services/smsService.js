const twilio = require('twilio');
const logger = require('../utils/logger');

class SMSService {
    constructor() {
        this.accountSid = process.env.TWILIO_ACCOUNT_SID;
        this.authToken = process.env.TWILIO_AUTH_TOKEN;
        this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
        
        if (this.accountSid && this.authToken) {
            this.client = twilio(this.accountSid, this.authToken);
            this.enabled = true;
        } else {
            this.enabled = false;
            logger.warn('Twilio not configured. SMS sending disabled.');
        }
    }

    /**
     * Send SMS
     */
    async sendSMS(to, message) {
        if (!this.enabled) {
            logger.debug(`SMS disabled. Would send to ${to}: ${message}`);
            return { success: false, error: 'SMS service not configured' };
        }

        try {
            const result = await this.client.messages.create({
                body: message,
                to,
                from: this.fromNumber
            });

            logger.info(`SMS sent: ${result.sid} to ${to}`);
            return { success: true, sid: result.sid };
        } catch (error) {
            logger.error('SMS send error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Send OTP
     */
    async sendOTP(phone, otp) {
        const message = `Your MozAic verification code is: ${otp}. Valid for 10 minutes.`;
        return await this.sendSMS(phone, message);
    }

    /**
     * Send transaction notification
     */
    async sendTransactionNotification(phone, type, amount) {
        const message = `MozAic: Your ${type} of ₦${amount} was successful. Thank you for using MozAic!`;
        return await this.sendSMS(phone, message);
    }

    /**
     * Send login notification
     */
    async sendLoginNotification(phone, device) {
        const message = `MozAic: New login detected from ${device}. If this wasn't you, please secure your account.`;
        return await this.sendSMS(phone, message);
    }

    /**
     * Send withdrawal notification
     */
    async sendWithdrawalNotification(phone, amount) {
        const message = `MozAic: Your withdrawal request of ₦${amount} has been processed. Check your bank account.`;
        return await this.sendSMS(phone, message);
    }
}

module.exports = new SMSService();