/**
 * reconcile-pending.js
 *
 * Fixes stuck "pending" Flutterwave transactions.
 *
 * Root cause of previous failure:
 *   - GET /transactions/by_ref/:ref  does NOT exist on Flutterwave v3 API.
 *   - The correct endpoint is GET /transactions?tx_ref=REF  (query param).
 *   - Debug output confirmed both transactions are "successful" on FLW side.
 *
 * Run: node scripts/reconcile-pending.js
 */

require('dotenv').config();
const axios     = require('axios');
const mongoose  = require('mongoose');
const connectDB = require('../src/config/database');

require('../src/models/User');
require('../src/models/Wallet');
require('../src/models/Transaction');

const Transaction = require('../src/models/Transaction');
const Wallet      = require('../src/models/Wallet');

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_BASE_URL   = process.env.FLW_BASE_URL || 'https://api.flutterwave.com/v3';

if (!FLW_SECRET_KEY) {
    console.error('\n❌  FLW_SECRET_KEY is not set in .env');
    process.exit(1);
}

const flw = axios.create({
    baseURL: FLW_BASE_URL,
    headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${FLW_SECRET_KEY}`
    },
    timeout: 30000
});

// ─── Flutterwave helpers using CORRECT endpoints ─────────────────────────────

/** GET /transactions?tx_ref=REF — list endpoint with filter (CORRECT) */
async function lookupByTxRef(txRef) {
    try {
        const res   = await flw.get('/transactions', { params: { tx_ref: txRef } });
        const items = res.data?.data;
        if (!Array.isArray(items) || items.length === 0) return null;
        return items.find(t => t.tx_ref === txRef) || null;
    } catch (err) {
        console.log(`  FLW tx_ref lookup error: ${err.response?.status || err.message}`);
        return null;
    }
}

/** GET /transactions/:id/verify — verify by FLW numeric ID */
async function lookupById(flwId) {
    try {
        const res = await flw.get(`/transactions/${flwId}/verify`);
        return res.data?.data || null;
    } catch (err) {
        console.log(`  FLW ID verify error: ${err.response?.status || err.message}`);
        return null;
    }
}

// ─── Credit wallet in a DB transaction ───────────────────────────────────────
async function creditWallet(tx, flwTx) {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        const freshTx = await Transaction.findById(tx._id).session(session);
        if (freshTx.status !== 'pending') {
            await session.abortTransaction();
            session.endSession();
            return { skipped: true, reason: `Already ${freshTx.status}` };
        }

        const wallet = await Wallet.findById(freshTx.wallet_id).session(session);
        if (!wallet) {
            await session.abortTransaction();
            session.endSession();
            return { skipped: true, reason: 'Wallet not found' };
        }

        const balanceBefore = wallet.balance;

        freshTx.status       = 'success';
        freshTx.external_ref = String(flwTx.id);
        freshTx.processed_at = new Date();
        freshTx.metadata     = {
            ...freshTx.metadata,
            flw_id:         flwTx.id,
            flw_ref:        flwTx.flw_ref,
            flw_status:     flwTx.status,
            amount_settled: flwTx.amount_settled,
            verified_at:    new Date().toISOString(),
            verified_via:   'reconciliation_script'
        };
        await freshTx.save({ session });
        await wallet.credit(freshTx.amount, session);

        await session.commitTransaction();
        session.endSession();

        return { ok: true, amount: freshTx.amount, balanceBefore, balanceAfter: wallet.balance };

    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        return { error: err.message };
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    await connectDB();

    console.log('\n' + '═'.repeat(58));
    console.log('   MozAic — Pending Transaction Reconciler (Fixed)');
    console.log('═'.repeat(58) + '\n');

    const pendingTxs = await Transaction.find({
        provider: 'flutterwave',
        type:     'credit',
        status:   'pending'
    });

    console.log(`Found ${pendingTxs.length} pending Flutterwave transaction(s)\n`);

    if (pendingTxs.length === 0) {
        console.log('Nothing to do. Exiting.');
        process.exit(0);
    }

    const results = { credited: 0, failed: 0, stillPending: 0, skipped: 0, errors: [] };

    for (const tx of pendingTxs) {
        console.log('─'.repeat(58));
        console.log(`Reference  : ${tx.reference}`);
        console.log(`Amount     : ₦${tx.amount}`);
        console.log(`Created    : ${tx.created_at}`);

        let flwTx = null;

        // Strategy 1 — correct endpoint: GET /transactions?tx_ref=...
        console.log(`\n  [1] GET /transactions?tx_ref=${tx.reference}`);
        flwTx = await lookupByTxRef(tx.reference);
        if (flwTx) {
            console.log(`      ✓ Found. FLW id=${flwTx.id}  status="${flwTx.status}"  ₦${flwTx.amount}`);
        } else {
            console.log(`      Not found.`);
        }

        // Strategy 2 — by stored FLW numeric ID (if we have it)
        if (!flwTx && tx.external_ref) {
            console.log(`\n  [2] GET /transactions/${tx.external_ref}/verify`);
            flwTx = await lookupById(tx.external_ref);
            if (flwTx) {
                console.log(`      ✓ Found. status="${flwTx.status}"`);
            }
        }

        // Not found anywhere
        if (!flwTx) {
            console.log(`\n  → ⏳ No Flutterwave record found (payment abandoned before completing)`);
            console.log(`       Marking as FAILED to clean up.`);
            await Transaction.findByIdAndUpdate(tx._id, {
                status:        'failed',
                failed_reason: 'Reconciliation: no matching record found in Flutterwave — payment likely abandoned'
            });
            results.failed++;
            continue;
        }

        // FLW says failed
        if (['failed', 'error'].includes(flwTx.status)) {
            console.log(`\n  → ❌ Flutterwave reports "${flwTx.status}" — marking as failed.`);
            await Transaction.findByIdAndUpdate(tx._id, {
                status:        'failed',
                failed_reason: `Reconciliation: Flutterwave status="${flwTx.status}"`,
                external_ref:  String(flwTx.id)
            });
            results.failed++;
            continue;
        }

        // FLW not yet settled
        if (flwTx.status !== 'successful') {
            console.log(`\n  → ⏳ Flutterwave status="${flwTx.status}" — leaving as pending.`);
            results.stillPending++;
            continue;
        }

        // FLW successful → credit wallet
        console.log(`\n  → ✅ Flutterwave CONFIRMED SUCCESSFUL — crediting wallet ₦${tx.amount}...`);
        const result = await creditWallet(tx, flwTx);

        if (result.ok) {
            console.log(`     ✅ Done!  Balance: ₦${result.balanceBefore} → ₦${result.balanceAfter}`);
            results.credited++;
        } else if (result.skipped) {
            console.log(`     ⏭  Skipped: ${result.reason}`);
            results.skipped++;
        } else {
            console.log(`     ❌ Error: ${result.error}`);
            results.errors.push({ reference: tx.reference, error: result.error });
        }
    }

    console.log('\n' + '═'.repeat(58));
    console.log('   Results');
    console.log('═'.repeat(58));
    console.log(`  ✅  Credited      : ${results.credited}`);
    console.log(`  ❌  Marked failed : ${results.failed}`);
    console.log(`  ⏳  Still pending : ${results.stillPending}`);
    console.log(`  ⏭   Skipped       : ${results.skipped}`);
    if (results.errors.length) {
        console.log(`\n  Errors:`);
        results.errors.forEach(e => console.log(`    ${e.reference}: ${e.error}`));
    }
    console.log('═'.repeat(58) + '\n');

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});