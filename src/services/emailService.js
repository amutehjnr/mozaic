console.log('📧 Email service loaded, BASE_URL:', process.env.BASE_URL);
try {
    new URL(process.env.BASE_URL);
    console.log('✅ Email service BASE_URL valid');
} catch (e) {
    console.error('❌ Email service BASE_URL invalid:', e.message);
}

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: parseInt(process.env.EMAIL_PORT) || 587,
            secure: process.env.EMAIL_PORT === '465',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            },
            pool: true,
            maxConnections: 5,
            maxMessages: 100,
            rateDelta: 1000,
            rateLimit: 5
        });

        this.from = `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`;
    }

    /**
     * Send email
     */
    async sendEmail(to, subject, html, options = {}) {
        const mailOptions = {
            from: options.from || this.from,
            to,
            subject,
            html,
            attachments: options.attachments || [],
            cc: options.cc,
            bcc: options.bcc,
            replyTo: options.replyTo
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            logger.info(`Email sent: ${info.messageId} to ${to}`);
            return { success: true, messageId: info.messageId };
        } catch (error) {
            logger.error('Email send error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Send welcome email
     */
    async sendWelcomeEmail(user) {
        const subject = 'Welcome to MozAic!';
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #EF5134;">Welcome to MozAic, ${user.name}!</h1>
                <p>Thank you for joining MozAic. We're excited to have you on board.</p>
                <p>With MozAic, you can:</p>
                <ul>
                    <li>Buy affordable data and airtime</li>
                    <li>Pay electricity and TV bills instantly</li>
                    <li>Manage your wallet and track transactions</li>
                </ul>
                <p>Get started by funding your wallet and making your first purchase.</p>
                <a href="${process.env.BASE_URL}/dashboard/user" 
                   style="background-color: #EF5134; color: white; padding: 10px 20px; 
                          text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">
                    Go to Dashboard
                </a>
            </div>
        `;

        return await this.sendEmail(user.email, subject, html);
    }

    /**
     * Send password reset email
     */
    async sendPasswordResetEmail(email, resetLink) {
        const subject = 'Reset Your MozAic Password';
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #EF5134;">Reset Your Password</h2>
                <p>We received a request to reset the password for <strong>${email}</strong>.</p>
                <p>Click the button below to reset your password. This link is valid for 10 minutes.</p>
                <a href="${resetLink}" 
                   style="background-color: #EF5134; color: white; padding: 10px 20px; 
                          text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0;">
                    Reset Password
                </a>
                <p>If you didn't request this, please ignore this email. Your password will remain unchanged.</p>
            </div>
        `;

        return await this.sendEmail(email, subject, html);
    }

    /**
     * Send transaction receipt
     */
    async sendTransactionReceipt(user, transaction) {
        const subject = `Transaction Receipt - ${transaction.reference}`;
        const amount = transaction.amount.toFixed(2);
        const date = new Date(transaction.created_at).toLocaleString();
        
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #EF5134;">Transaction Receipt</h2>
                <p>Hi ${user.name},</p>
                <p>Your transaction has been completed successfully.</p>
                
                <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
                    <p><strong>Reference:</strong> ${transaction.reference}</p>
                    <p><strong>Type:</strong> ${transaction.type}</p>
                    <p><strong>Provider:</strong> ${transaction.provider}</p>
                    <p><strong>Amount:</strong> ₦${amount}</p>
                    <p><strong>Status:</strong> ${transaction.status}</p>
                    <p><strong>Date:</strong> ${date}</p>
                </div>
                
                <p>Thank you for using MozAic!</p>
            </div>
        `;

        return await this.sendEmail(user.email, subject, html);
    }

    /**
     * Send KYC verification status
     */
    async sendKYCStatusEmail(user, kyc) {
        const subject = `KYC Verification ${kyc.status}`;
        const isVerified = kyc.status === 'verified';
        
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #EF5134;">KYC Verification ${isVerified ? 'Approved' : 'Update'}</h2>
                <p>Hi ${user.name},</p>
                ${isVerified 
                    ? `<p>Your KYC verification has been approved! You now have higher transaction limits.</p>`
                    : kyc.status === 'rejected'
                        ? `<p>Your KYC verification was rejected. Reason: ${kyc.rejected_reason}</p>
                           <p>Please update your information and try again.</p>`
                        : `<p>Your KYC verification is currently ${kyc.status}. We'll notify you once it's reviewed.</p>`
                }
            </div>
        `;

        return await this.sendEmail(user.email, subject, html);
    }

    /**
     * Send referral bonus email
     */
    async sendReferralBonusEmail(user, bonus, referredUser) {
        const subject = 'You Earned a Referral Bonus!';
        const amount = bonus.toFixed(2);
        
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #EF5134;">Referral Bonus Earned!</h2>
                <p>Hi ${user.name},</p>
                <p>Great news! Your referral ${referredUser.name || 'friend'} has made their first transaction.</p>
                <p>You've earned a bonus of <strong>₦${amount}</strong> which has been added to your wallet.</p>
                <p>Keep sharing your referral link to earn more!</p>
            </div>
        `;

        return await this.sendEmail(user.email, subject, html);
    }

    /**
     * Send withdrawal notification
     */
    async sendWithdrawalNotification(user, withdrawal) {
        const subject = 'Withdrawal Request Received';
        const amount = withdrawal.amount.toFixed(2);
        
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #EF5134;">Withdrawal Request Received</h2>
                <p>Hi ${user.name},</p>
                <p>Your withdrawal request has been received and is being processed.</p>
                
                <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
                    <p><strong>Amount:</strong> ₦${amount}</p>
                    <p><strong>Bank:</strong> ${withdrawal.bank}</p>
                    <p><strong>Account:</strong> ****${withdrawal.account.slice(-4)}</p>
                    <p><strong>Reference:</strong> ${withdrawal.reference}</p>
                </div>
                
                <p>You'll receive another notification once the transfer is completed.</p>
            </div>
        `;

        return await this.sendEmail(user.email, subject, html);
    }
}

module.exports = new EmailService();