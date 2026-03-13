const KycProfile = require('../models/KycProfile');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

class KycController {
    constructor() {
        // Configure multer for file uploads
        this.upload = multer({
            storage: multer.diskStorage({
                destination: (req, file, cb) => {
                    const uploadDir = path.join(__dirname, '../../public/uploads/kyc');
                    if (!fs.existsSync(uploadDir)) {
                        fs.mkdirSync(uploadDir, { recursive: true });
                    }
                    cb(null, uploadDir);
                },
                filename: (req, file, cb) => {
                    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                    const ext = path.extname(file.originalname);
                    cb(null, `kyc-${req.user._id}-${uniqueSuffix}${ext}`);
                }
            }),
            limits: {
                fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB
            },
            fileFilter: (req, file, cb) => {
                const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
                if (allowedTypes.includes(file.mimetype)) {
                    cb(null, true);
                } else {
                    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF are allowed.'));
                }
            }
        }).fields([
            { name: 'id_front', maxCount: 1 },
            { name: 'id_back', maxCount: 1 },
            { name: 'selfie', maxCount: 1 },
            { name: 'proof_of_address', maxCount: 1 }
        ]);
    }

    /**
     * Show KYC page
     */
    async showKycPage(req, res) {
        try {
            let kyc = await KycProfile.findOne({ user_id: req.user._id });

            res.render('dashboard/verify/index', {
                title: 'KYC Verification',
                kyc: kyc || {},
                user: req.user
            });
        } catch (error) {
            logger.error('Show KYC page error:', error);
            req.flash('error', 'Failed to load KYC page');
            res.redirect('/dashboard/user');
        }
    }

    /**
     * Save personal details
     */
    async savePersonalDetails(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.flash('error', errors.array()[0].msg);
            return res.redirect('/dashboard/verify');
        }

        const { first_name, last_name, dob, bvn, address } = req.body;

        try {
            // Find or create KYC profile
            let kyc = await KycProfile.findOne({ user_id: req.user._id });

            if (!kyc) {
                kyc = new KycProfile({
                    user_id: req.user._id,
                    status: 'draft'
                });
            }

            // Update fields
            if (first_name) kyc.first_name = first_name;
            if (last_name) kyc.last_name = last_name;
            if (dob) kyc.dob = new Date(dob);
            if (bvn) kyc.bvn = bvn;
            if (address) {
                kyc.address = {
                    ...kyc.address,
                    street: address
                };
            }

            await kyc.save();

            req.flash('success', 'Personal details saved successfully');
            res.redirect('/dashboard/verify');
        } catch (error) {
            logger.error('Save personal details error:', error);
            req.flash('error', 'Failed to save personal details');
            res.redirect('/dashboard/verify');
        }
    }

    /**
     * Upload KYC documents
     */
    async uploadDocuments(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                ok: false,
                error: errors.array()[0].msg
            });
        }

        const { id_type, id_number } = req.body;

        try {
            // Find or create KYC profile
            let kyc = await KycProfile.findOne({ user_id: req.user._id });

            if (!kyc) {
                kyc = new KycProfile({
                    user_id: req.user._id,
                    status: 'draft'
                });
            }

            // Update ID type and number
            if (id_type) kyc.id_type = id_type;
            if (id_number) kyc.id_number = id_number;

            // Handle file uploads
            const files = req.files || {};

            // Process ID front
            if (files.id_front && files.id_front[0]) {
                const file = files.id_front[0];
                const filePath = `/uploads/kyc/${file.filename}`;
                
                // Optimize image if it's an image
                if (file.mimetype.startsWith('image/') && file.mimetype !== 'image/gif') {
                    const outputPath = path.join(__dirname, '../../public/uploads/kyc', `optimized-${file.filename}`);
                    await sharp(file.path)
                        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                        .jpeg({ quality: 80 })
                        .toFile(outputPath);
                    
                    // Replace with optimized version
                    fs.unlinkSync(file.path);
                    fs.renameSync(outputPath, file.path);
                }
                
                kyc.id_front_path = filePath;
            }

            // Process ID back
            if (files.id_back && files.id_back[0]) {
                const file = files.id_back[0];
                const filePath = `/uploads/kyc/${file.filename}`;
                
                if (file.mimetype.startsWith('image/') && file.mimetype !== 'image/gif') {
                    const outputPath = path.join(__dirname, '../../public/uploads/kyc', `optimized-${file.filename}`);
                    await sharp(file.path)
                        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                        .jpeg({ quality: 80 })
                        .toFile(outputPath);
                    
                    fs.unlinkSync(file.path);
                    fs.renameSync(outputPath, file.path);
                }
                
                kyc.id_back_path = filePath;
            }

            // Process selfie
            if (files.selfie && files.selfie[0]) {
                const file = files.selfie[0];
                const filePath = `/uploads/kyc/${file.filename}`;
                
                if (file.mimetype.startsWith('image/') && file.mimetype !== 'image/gif') {
                    const outputPath = path.join(__dirname, '../../public/uploads/kyc', `optimized-${file.filename}`);
                    await sharp(file.path)
                        .resize(800, 800, { fit: 'cover' })
                        .jpeg({ quality: 85 })
                        .toFile(outputPath);
                    
                    fs.unlinkSync(file.path);
                    fs.renameSync(outputPath, file.path);
                }
                
                kyc.selfie_path = filePath;
            }

            // Process proof of address
            if (files.proof_of_address && files.proof_of_address[0]) {
                const file = files.proof_of_address[0];
                const filePath = `/uploads/kyc/${file.filename}`;
                kyc.proof_of_address_path = filePath;
            }

            await kyc.save();

            res.json({
                ok: true,
                message: 'Documents uploaded successfully',
                kyc: {
                    id_front_path: kyc.id_front_path,
                    id_back_path: kyc.id_back_path,
                    selfie_path: kyc.selfie_path,
                    proof_of_address_path: kyc.proof_of_address_path
                }
            });
        } catch (error) {
            logger.error('Upload documents error:', error);
            res.status(500).json({
                ok: false,
                error: error.message || 'Failed to upload documents'
            });
        }
    }

    /**
     * Submit KYC for verification
     */
    async submitKyc(req, res) {
        try {
            const kyc = await KycProfile.findOne({ user_id: req.user._id });

            if (!kyc) {
                req.flash('error', 'Please complete your KYC details first');
                return res.redirect('/dashboard/verify');
            }

            // Validate required fields
            if (!kyc.first_name || !kyc.last_name || !kyc.dob) {
                req.flash('error', 'Please complete your personal details');
                return res.redirect('/dashboard/verify');
            }

            if (!kyc.id_type || !kyc.id_number) {
                req.flash('error', 'Please select ID type and enter ID number');
                return res.redirect('/dashboard/verify');
            }

            if (!kyc.id_front_path) {
                req.flash('error', 'Please upload front of ID');
                return res.redirect('/dashboard/verify');
            }

            // Submit for verification
            await kyc.submit();

            // Send notification to admin (implement based on your needs)
            // ...

            req.flash('success', 'KYC submitted successfully. We\'ll review it shortly.');
            res.redirect('/dashboard/verify');
        } catch (error) {
            logger.error('Submit KYC error:', error);
            req.flash('error', 'Failed to submit KYC');
            res.redirect('/dashboard/verify');
        }
    }

    /**
     * Get KYC status
     */
    async getKycStatus(req, res) {
        try {
            const kyc = await KycProfile.findOne({ user_id: req.user._id });

            if (!kyc) {
                return res.json({
                    ok: true,
                    status: 'not_started',
                    message: 'KYC not started'
                });
            }

            const response = {
                ok: true,
                status: kyc.status,
                tier: kyc.tier,
                message: this.getStatusMessage(kyc.status)
            };

            // Include rejection reason if applicable
            if (kyc.status === 'rejected' && kyc.rejected_reason) {
                response.reason = kyc.rejected_reason;
            }

            // Include verification date if verified
            if (kyc.status === 'verified' && kyc.verified_at) {
                response.verified_at = kyc.verified_at;
                response.expires_at = kyc.expires_at;
            }

            res.json(response);
        } catch (error) {
            logger.error('Get KYC status error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get KYC status'
            });
        }
    }

    /**
     * Get status message helper
     */
    getStatusMessage(status) {
        const messages = {
            'draft': 'KYC not submitted yet',
            'pending': 'KYC under review',
            'verified': 'KYC verified successfully',
            'rejected': 'KYC verification failed',
            'expired': 'KYC expired, please resubmit'
        };
        return messages[status] || 'Unknown status';
    }

    /**
     * Admin: Get all pending KYC
     */
    async getPendingKyc(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const skip = (page - 1) * limit;

            const pending = await KycProfile.find({ status: 'pending' })
                .populate('user_id', 'name email phone created_at')
                .sort({ created_at: 1 })
                .skip(skip)
                .limit(limit);

            const total = await KycProfile.countDocuments({ status: 'pending' });

            res.json({
                ok: true,
                pending: pending.map(p => ({
                    id: p._id,
                    user: {
                        id: p.user_id._id,
                        name: p.user_id.name,
                        email: p.user_id.email,
                        phone: p.user_id.phone,
                        joined: p.user_id.created_at
                    },
                    personal: {
                        first_name: p.first_name,
                        last_name: p.last_name,
                        dob: p.dob,
                        bvn: p.bvn ? '********' : null
                    },
                    documents: {
                        id_type: p.id_type,
                        id_number: p.id_number,
                        id_front: p.id_front_path,
                        id_back: p.id_back_path,
                        selfie: p.selfie_path,
                        proof_of_address: p.proof_of_address_path
                    },
                    submitted_at: p.updated_at
                })),
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            logger.error('Get pending KYC error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get pending KYC'
            });
        }
    }

    /**
     * Admin: Verify KYC
     */
    async verifyKyc(req, res) {
        const { id } = req.params;
        const { notes } = req.body;

        try {
            const kyc = await KycProfile.findById(id).populate('user_id');

            if (!kyc) {
                return res.status(404).json({
                    ok: false,
                    error: 'KYC record not found'
                });
            }

            if (kyc.status !== 'pending') {
                return res.status(400).json({
                    ok: false,
                    error: `KYC is already ${kyc.status}`
                });
            }

            // Verify KYC
            await kyc.verify(req.user._id);

            // Update user tier based on KYC level
            const user = await User.findById(kyc.user_id._id);
            // Implement tier update logic based on your business rules
            // ...

            // Send notification email
            await emailService.sendKYCStatusEmail(kyc.user_id, {
                status: 'verified',
                verified_at: new Date()
            });

            res.json({
                ok: true,
                message: 'KYC verified successfully'
            });
        } catch (error) {
            logger.error('Verify KYC error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to verify KYC'
            });
        }
    }

    /**
     * Admin: Reject KYC
     */
    async rejectKyc(req, res) {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({
                ok: false,
                error: 'Rejection reason is required'
            });
        }

        try {
            const kyc = await KycProfile.findById(id).populate('user_id');

            if (!kyc) {
                return res.status(404).json({
                    ok: false,
                    error: 'KYC record not found'
                });
            }

            if (kyc.status !== 'pending') {
                return res.status(400).json({
                    ok: false,
                    error: `KYC is already ${kyc.status}`
                });
            }

            // Reject KYC
            await kyc.reject(reason, req.user._id);

            // Send notification email
            await emailService.sendKYCStatusEmail(kyc.user_id, {
                status: 'rejected',
                reason
            });

            res.json({
                ok: true,
                message: 'KYC rejected',
                reason
            });
        } catch (error) {
            logger.error('Reject KYC error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to reject KYC'
            });
        }
    }
}

module.exports = new KycController();