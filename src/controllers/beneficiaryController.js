const Beneficiary = require('../models/Beneficiary');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

class BeneficiaryController {
    /**
     * Show beneficiaries page
     */
    async showBeneficiariesPage(req, res) {
        try {
            const beneficiaries = await Beneficiary.find({ 
                user_id: req.user._id 
            }).sort({ isFavorite: -1, usage_count: -1, created_at: -1 });

            res.render('dashboard/beneficiaries/index', {
                title: 'Beneficiaries',
                beneficiaries: beneficiaries.map(b => ({
                    id: b._id,
                    type: b.type,
                    label: b.label,
                    value: b.value,
                    provider: b.provider,
                    isFavorite: b.isFavorite,
                    usage_count: b.usage_count,
                    last_used: b.last_used_at,
                    created_at: b.created_at
                }))
            });
        } catch (error) {
            logger.error('Show beneficiaries page error:', error);
            req.flash('error', 'Failed to load beneficiaries');
            res.redirect('/dashboard/user');
        }
    }

    /**
     * Get all beneficiaries
     */
    async getBeneficiaries(req, res) {
        try {
            const { type, favorite } = req.query;
            
            // Build query
            const query = { user_id: req.user._id };
            if (type) query.type = type;
            if (favorite === 'true') query.isFavorite = true;

            const beneficiaries = await Beneficiary.find(query)
                .sort({ isFavorite: -1, usage_count: -1, last_used_at: -1 });

            res.json({
                ok: true,
                beneficiaries: beneficiaries.map(b => ({
                    id: b._id,
                    type: b.type,
                    label: b.label,
                    value: b.value,
                    provider: b.provider,
                    isFavorite: b.isFavorite,
                    usage_count: b.usage_count,
                    last_used: b.last_used_at,
                    metadata: b.metadata
                }))
            });
        } catch (error) {
            logger.error('Get beneficiaries error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get beneficiaries'
            });
        }
    }

    /**
     * Get single beneficiary
     */
    async getBeneficiary(req, res) {
        try {
            const { id } = req.params;

            const beneficiary = await Beneficiary.findOne({
                _id: id,
                user_id: req.user._id
            });

            if (!beneficiary) {
                return res.status(404).json({
                    ok: false,
                    error: 'Beneficiary not found'
                });
            }

            res.json({
                ok: true,
                beneficiary: {
                    id: beneficiary._id,
                    type: beneficiary.type,
                    label: beneficiary.label,
                    value: beneficiary.value,
                    provider: beneficiary.provider,
                    isFavorite: beneficiary.isFavorite,
                    usage_count: beneficiary.usage_count,
                    last_used: beneficiary.last_used_at,
                    metadata: beneficiary.metadata,
                    created_at: beneficiary.created_at
                }
            });
        } catch (error) {
            logger.error('Get beneficiary error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get beneficiary'
            });
        }
    }

    /**
     * Create beneficiary
     */
    async createBeneficiary(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                ok: false,
                error: errors.array()[0].msg
            });
        }

        const { type, label, value, provider, isFavorite, metadata } = req.body;

        try {
            // Check for duplicates
            const existing = await Beneficiary.findOne({
                user_id: req.user._id,
                type,
                value
            });

            if (existing) {
                return res.status(409).json({
                    ok: false,
                    error: 'Beneficiary already exists'
                });
            }

            // Create beneficiary
            const beneficiary = await Beneficiary.create({
                user_id: req.user._id,
                type,
                label,
                value,
                provider,
                isFavorite: isFavorite || false,
                metadata: metadata || {}
            });

            res.status(201).json({
                ok: true,
                message: 'Beneficiary created successfully',
                beneficiary: {
                    id: beneficiary._id,
                    type: beneficiary.type,
                    label: beneficiary.label,
                    value: beneficiary.value,
                    provider: beneficiary.provider,
                    isFavorite: beneficiary.isFavorite
                }
            });
        } catch (error) {
            logger.error('Create beneficiary error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to create beneficiary'
            });
        }
    }

    /**
     * Update beneficiary
     */
    async updateBeneficiary(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({
                ok: false,
                error: errors.array()[0].msg
            });
        }

        const { id } = req.params;
        const { label, value, provider, isFavorite, metadata } = req.body;

        try {
            const beneficiary = await Beneficiary.findOne({
                _id: id,
                user_id: req.user._id
            });

            if (!beneficiary) {
                return res.status(404).json({
                    ok: false,
                    error: 'Beneficiary not found'
                });
            }

            // Update fields
            if (label) beneficiary.label = label;
            if (value) beneficiary.value = value;
            if (provider) beneficiary.provider = provider;
            if (isFavorite !== undefined) beneficiary.isFavorite = isFavorite;
            if (metadata) beneficiary.metadata = { ...beneficiary.metadata, ...metadata };

            await beneficiary.save();

            res.json({
                ok: true,
                message: 'Beneficiary updated successfully',
                beneficiary: {
                    id: beneficiary._id,
                    type: beneficiary.type,
                    label: beneficiary.label,
                    value: beneficiary.value,
                    provider: beneficiary.provider,
                    isFavorite: beneficiary.isFavorite
                }
            });
        } catch (error) {
            logger.error('Update beneficiary error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to update beneficiary'
            });
        }
    }

    /**
     * Delete beneficiary
     */
    async deleteBeneficiary(req, res) {
        const { id } = req.params;

        try {
            const result = await Beneficiary.deleteOne({
                _id: id,
                user_id: req.user._id
            });

            if (result.deletedCount === 0) {
                return res.status(404).json({
                    ok: false,
                    error: 'Beneficiary not found'
                });
            }

            res.json({
                ok: true,
                message: 'Beneficiary deleted successfully'
            });
        } catch (error) {
            logger.error('Delete beneficiary error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to delete beneficiary'
            });
        }
    }

    /**
     * Toggle favorite
     */
    async toggleFavorite(req, res) {
        const { id } = req.params;

        try {
            const beneficiary = await Beneficiary.findOne({
                _id: id,
                user_id: req.user._id
            });

            if (!beneficiary) {
                return res.status(404).json({
                    ok: false,
                    error: 'Beneficiary not found'
                });
            }

            beneficiary.isFavorite = !beneficiary.isFavorite;
            await beneficiary.save();

            res.json({
                ok: true,
                message: beneficiary.isFavorite ? 'Added to favorites' : 'Removed from favorites',
                isFavorite: beneficiary.isFavorite
            });
        } catch (error) {
            logger.error('Toggle favorite error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to toggle favorite'
            });
        }
    }

    /**
     * Increment usage count
     */
    async incrementUsage(req, res) {
        const { id } = req.params;

        try {
            const beneficiary = await Beneficiary.findOne({
                _id: id,
                user_id: req.user._id
            });

            if (!beneficiary) {
                return res.status(404).json({
                    ok: false,
                    error: 'Beneficiary not found'
                });
            }

            await beneficiary.incrementUsage();

            res.json({
                ok: true,
                message: 'Usage count updated',
                usage_count: beneficiary.usage_count,
                last_used: beneficiary.last_used_at
            });
        } catch (error) {
            logger.error('Increment usage error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to update usage count'
            });
        }
    }

    /**
     * Get frequently used beneficiaries
     */
    async getFrequentlyUsed(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 5;

            const beneficiaries = await Beneficiary.find({
                user_id: req.user._id,
                usage_count: { $gt: 0 }
            })
                .sort({ usage_count: -1, last_used_at: -1 })
                .limit(limit);

            res.json({
                ok: true,
                beneficiaries: beneficiaries.map(b => ({
                    id: b._id,
                    type: b.type,
                    label: b.label,
                    value: b.value,
                    provider: b.provider,
                    usage_count: b.usage_count,
                    last_used: b.last_used_at
                }))
            });
        } catch (error) {
            logger.error('Get frequently used error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to get frequently used beneficiaries'
            });
        }
    }

    /**
     * Bulk delete beneficiaries
     */
    async bulkDelete(req, res) {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({
                ok: false,
                error: 'No beneficiary IDs provided'
            });
        }

        try {
            const result = await Beneficiary.deleteMany({
                _id: { $in: ids },
                user_id: req.user._id
            });

            res.json({
                ok: true,
                message: `Deleted ${result.deletedCount} beneficiaries`,
                count: result.deletedCount
            });
        } catch (error) {
            logger.error('Bulk delete error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to delete beneficiaries'
            });
        }
    }

    /**
     * Import beneficiaries
     */
    async importBeneficiaries(req, res) {
        const { beneficiaries } = req.body;

        if (!beneficiaries || !Array.isArray(beneficiaries) || beneficiaries.length === 0) {
            return res.status(400).json({
                ok: false,
                error: 'No beneficiaries to import'
            });
        }

        try {
            const results = {
                success: 0,
                failed: 0,
                errors: []
            };

            for (const b of beneficiaries) {
                try {
                    // Validate required fields
                    if (!b.type || !b.label || !b.value) {
                        results.failed++;
                        results.errors.push({
                            beneficiary: b,
                            error: 'Missing required fields'
                        });
                        continue;
                    }

                    // Check for duplicates
                    const existing = await Beneficiary.findOne({
                        user_id: req.user._id,
                        type: b.type,
                        value: b.value
                    });

                    if (existing) {
                        results.failed++;
                        results.errors.push({
                            beneficiary: b,
                            error: 'Duplicate beneficiary'
                        });
                        continue;
                    }

                    // Create beneficiary
                    await Beneficiary.create({
                        user_id: req.user._id,
                        type: b.type,
                        label: b.label,
                        value: b.value,
                        provider: b.provider,
                        isFavorite: b.isFavorite || false,
                        metadata: b.metadata || {}
                    });

                    results.success++;
                } catch (err) {
                    results.failed++;
                    results.errors.push({
                        beneficiary: b,
                        error: err.message
                    });
                }
            }

            res.json({
                ok: true,
                message: `Imported ${results.success} beneficiaries, ${results.failed} failed`,
                results
            });
        } catch (error) {
            logger.error('Import beneficiaries error:', error);
            res.status(500).json({
                ok: false,
                error: 'Failed to import beneficiaries'
            });
        }
    }
}

module.exports = new BeneficiaryController();