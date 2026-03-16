const Beneficiary = require('../models/Beneficiary');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Normalise type to lowercase so 'Airtime' → 'airtime' regardless of what
 * the form submits. This covers the form using capitalised option values.
 */
function normaliseType(type) {
    return (type || '').toLowerCase().trim();
}

/**
 * Normalise provider to lowercase (empty string is fine).
 */
function normaliseProvider(provider) {
    return (provider || '').toLowerCase().trim();
}

class BeneficiaryController {

    // ─── Page render ──────────────────────────────────────────────────────────

    /**
     * Show beneficiaries page.
     * FIX: variable was named 'beneficiaries' but view expected 'beneficiariesData'.
     * We now pass both so either name works.
     */
    async showBeneficiariesPage(req, res) {
        try {
            const docs = await Beneficiary.find({
                user_id: req.user._id
            }).sort({ isFavorite: -1, usage_count: -1, created_at: -1 });

            const mapped = docs.map(b => ({
                id:          b._id,
                type:        b.type,
                label:       b.label,
                value:       b.value,
                provider:    b.provider,
                isFavorite:  b.isFavorite,
                usage_count: b.usage_count,
                last_used:   b.last_used_at,
                created_at:  b.created_at
            }));

            res.render('dashboard/beneficiaries/index', {
                title:            'Beneficiaries',
                // Provide both names so the view works regardless of which it uses
                beneficiaries:     mapped,
                beneficiariesData: mapped,
                user:              req.user
            });
        } catch (error) {
            logger.error('Show beneficiaries page error:', error);
            req.flash('error', 'Failed to load beneficiaries');
            res.redirect('/dashboard/user');
        }
    }

    // ─── GET list ─────────────────────────────────────────────────────────────

    async getBeneficiaries(req, res) {
        try {
            const { type, favorite } = req.query;
            const query = { user_id: req.user._id };
            if (type)              query.type       = normaliseType(type);
            if (favorite === 'true') query.isFavorite = true;

            const docs = await Beneficiary.find(query)
                .sort({ isFavorite: -1, usage_count: -1, last_used_at: -1 });

            res.json({
                ok: true,
                beneficiaries: docs.map(b => ({
                    id:          b._id,
                    type:        b.type,
                    label:       b.label,
                    value:       b.value,
                    provider:    b.provider,
                    isFavorite:  b.isFavorite,
                    usage_count: b.usage_count,
                    last_used:   b.last_used_at,
                    metadata:    b.metadata
                }))
            });
        } catch (error) {
            logger.error('Get beneficiaries error:', error);
            res.status(500).json({ ok: false, error: 'Failed to get beneficiaries' });
        }
    }

    // ─── GET single ───────────────────────────────────────────────────────────

    async getBeneficiary(req, res) {
        try {
            const b = await Beneficiary.findOne({
                _id:     req.params.id,
                user_id: req.user._id
            });
            if (!b) return res.status(404).json({ ok: false, error: 'Beneficiary not found' });

            res.json({
                ok: true,
                beneficiary: {
                    id:          b._id,
                    type:        b.type,
                    label:       b.label,
                    value:       b.value,
                    provider:    b.provider,
                    isFavorite:  b.isFavorite,
                    usage_count: b.usage_count,
                    last_used:   b.last_used_at,
                    metadata:    b.metadata,
                    created_at:  b.created_at
                }
            });
        } catch (error) {
            logger.error('Get beneficiary error:', error);
            res.status(500).json({ ok: false, error: 'Failed to get beneficiary' });
        }
    }

    // ─── CREATE ───────────────────────────────────────────────────────────────

    /**
     * FIX: normalise type and provider to lowercase before saving so 'Airtime'
     * doesn't fail the model enum ['data','airtime','electricity','tv'].
     * FIX: add handleMultipart upstream (done in route file).
     */
    async createBeneficiary(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ ok: false, error: errors.array()[0].msg });
        }

        const type     = normaliseType(req.body.type);
        const label    = (req.body.label    || '').trim();
        const value    = (req.body.value    || '').trim();
        const provider = normaliseProvider(req.body.provider);
        const metadata = req.body.metadata || {};

        if (!type || !label || !value) {
            return res.status(422).json({ ok: false, error: 'Type, label and value are required' });
        }

        try {
            // Duplicate check
            const existing = await Beneficiary.findOne({
                user_id: req.user._id,
                type,
                value
            });
            if (existing) {
                return res.status(409).json({ ok: false, error: 'A beneficiary with this value already exists' });
            }

            const b = await Beneficiary.create({
                user_id:    req.user._id,
                type,
                label,
                value,
                provider,
                isFavorite: req.body.isFavorite === 'true' || req.body.isFavorite === true,
                metadata
            });

            res.status(201).json({
                ok:      true,
                message: 'Beneficiary saved successfully',
                beneficiary: {
                    id:         b._id,
                    type:       b.type,
                    label:      b.label,
                    value:      b.value,
                    provider:   b.provider,
                    isFavorite: b.isFavorite
                }
            });
        } catch (error) {
            logger.error('Create beneficiary error:', error);
            // Surface Mongoose validation errors clearly
            if (error.name === 'ValidationError') {
                const msg = Object.values(error.errors).map(e => e.message).join(', ');
                return res.status(422).json({ ok: false, error: msg });
            }
            res.status(500).json({ ok: false, error: 'Failed to save beneficiary' });
        }
    }

    // ─── UPDATE ───────────────────────────────────────────────────────────────

    async updateBeneficiary(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(422).json({ ok: false, error: errors.array()[0].msg });
        }

        try {
            const b = await Beneficiary.findOne({
                _id:     req.params.id,
                user_id: req.user._id
            });
            if (!b) return res.status(404).json({ ok: false, error: 'Beneficiary not found' });

            if (req.body.label    !== undefined) b.label    = req.body.label.trim();
            if (req.body.value    !== undefined) b.value    = req.body.value.trim();
            if (req.body.provider !== undefined) b.provider = normaliseProvider(req.body.provider);
            if (req.body.isFavorite !== undefined) b.isFavorite = req.body.isFavorite === 'true' || req.body.isFavorite === true;
            if (req.body.metadata !== undefined) b.metadata = { ...b.metadata, ...req.body.metadata };

            await b.save();

            res.json({
                ok:      true,
                message: 'Beneficiary updated',
                beneficiary: { id: b._id, type: b.type, label: b.label, value: b.value, provider: b.provider, isFavorite: b.isFavorite }
            });
        } catch (error) {
            logger.error('Update beneficiary error:', error);
            res.status(500).json({ ok: false, error: 'Failed to update beneficiary' });
        }
    }

    // ─── DELETE ───────────────────────────────────────────────────────────────

    async deleteBeneficiary(req, res) {
        try {
            const result = await Beneficiary.deleteOne({
                _id:     req.params.id,
                user_id: req.user._id
            });
            if (result.deletedCount === 0) {
                return res.status(404).json({ ok: false, error: 'Beneficiary not found' });
            }
            res.json({ ok: true, message: 'Beneficiary deleted' });
        } catch (error) {
            logger.error('Delete beneficiary error:', error);
            res.status(500).json({ ok: false, error: 'Failed to delete beneficiary' });
        }
    }

    // ─── TOGGLE FAVORITE ──────────────────────────────────────────────────────

    /**
     * FIX: was called toggleFavorite in dashboard routes but the view JS was
     * calling /api/beneficiaries/:id/favorite.  We expose this method for both
     * route names (/toggle-favorite and /favorite).
     */
    async toggleFavorite(req, res) {
        try {
            const b = await Beneficiary.findOne({
                _id:     req.params.id,
                user_id: req.user._id
            });
            if (!b) return res.status(404).json({ ok: false, error: 'Beneficiary not found' });

            b.isFavorite = !b.isFavorite;
            await b.save();

            res.json({
                ok:         true,
                message:    b.isFavorite ? 'Added to favourites' : 'Removed from favourites',
                isFavorite: b.isFavorite
            });
        } catch (error) {
            logger.error('Toggle favourite error:', error);
            res.status(500).json({ ok: false, error: 'Failed to update favourite' });
        }
    }

    // ─── INCREMENT USAGE ──────────────────────────────────────────────────────

    async incrementUsage(req, res) {
        try {
            const b = await Beneficiary.findOne({
                _id:     req.params.id,
                user_id: req.user._id
            });
            if (!b) return res.status(404).json({ ok: false, error: 'Beneficiary not found' });

            await b.incrementUsage();
            res.json({ ok: true, usage_count: b.usage_count, last_used: b.last_used_at });
        } catch (error) {
            logger.error('Increment usage error:', error);
            res.status(500).json({ ok: false, error: 'Failed to update usage' });
        }
    }

    // ─── FREQUENTLY USED ──────────────────────────────────────────────────────

    async getFrequentlyUsed(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 5;
            const docs  = await Beneficiary.find({
                user_id:     req.user._id,
                usage_count: { $gt: 0 }
            }).sort({ usage_count: -1, last_used_at: -1 }).limit(limit);

            res.json({
                ok: true,
                beneficiaries: docs.map(b => ({
                    id:          b._id,
                    type:        b.type,
                    label:       b.label,
                    value:       b.value,
                    provider:    b.provider,
                    usage_count: b.usage_count,
                    last_used:   b.last_used_at
                }))
            });
        } catch (error) {
            logger.error('Get frequently used error:', error);
            res.status(500).json({ ok: false, error: 'Failed to get frequently used beneficiaries' });
        }
    }

    // ─── BULK DELETE ──────────────────────────────────────────────────────────

    async bulkDelete(req, res) {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ ok: false, error: 'No IDs provided' });
        }
        try {
            const result = await Beneficiary.deleteMany({
                _id:     { $in: ids },
                user_id: req.user._id
            });
            res.json({ ok: true, message: `Deleted ${result.deletedCount} beneficiaries`, count: result.deletedCount });
        } catch (error) {
            logger.error('Bulk delete error:', error);
            res.status(500).json({ ok: false, error: 'Failed to delete beneficiaries' });
        }
    }

    // ─── IMPORT ───────────────────────────────────────────────────────────────

    async importBeneficiaries(req, res) {
        const { beneficiaries } = req.body;
        if (!beneficiaries || !Array.isArray(beneficiaries) || beneficiaries.length === 0) {
            return res.status(400).json({ ok: false, error: 'No beneficiaries to import' });
        }

        const results = { success: 0, failed: 0, errors: [] };

        for (const b of beneficiaries) {
            try {
                const type  = normaliseType(b.type);
                const value = (b.value || '').trim();

                if (!type || !b.label || !value) {
                    results.failed++;
                    results.errors.push({ beneficiary: b, error: 'Missing required fields' });
                    continue;
                }

                const existing = await Beneficiary.findOne({ user_id: req.user._id, type, value });
                if (existing) {
                    results.failed++;
                    results.errors.push({ beneficiary: b, error: 'Duplicate beneficiary' });
                    continue;
                }

                await Beneficiary.create({
                    user_id:    req.user._id,
                    type,
                    label:      b.label,
                    value,
                    provider:   normaliseProvider(b.provider),
                    isFavorite: b.isFavorite || false,
                    metadata:   b.metadata || {}
                });
                results.success++;
            } catch (err) {
                results.failed++;
                results.errors.push({ beneficiary: b, error: err.message });
            }
        }

        res.json({
            ok:      true,
            message: `Imported ${results.success} beneficiaries, ${results.failed} failed`,
            results
        });
    }
}

module.exports = new BeneficiaryController();