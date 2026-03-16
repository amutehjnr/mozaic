/**
 * reconcile-pending.js
 *
 * One-shot script to fix stuck "pending" Flutterwave transactions.
 * Run with:  node scripts/reconcile-pending.js
 *
 * It checks every pending Flutterwave credit transaction against the
 * Flutterwave API and credits the user's wallet for any that succeeded.
 */

require('dotenv').config();
const mongoose   = require('mongoose');
const connectDB  = require('../src/config/database');

// ── Register models ──────────────────────────────────────────────────────
require('../src/models/User');
require('../src/models/Wallet');
require('../src/models/Transaction');

const Transaction = require('../src/models/Transaction');
const Wallet      = require('../src/models/Wallet');
const User        = require('../src/models/User');
const flwService  = require('../src/services/flutterwaveService');

async function main() {
    await connectDB();
    console.log('\n═══════════════════════════════════════');
    console.log('   MozAic — Pending Transaction Reconciler');
    console.log('═══════════════════════════════════════\n');

    const pending = await Transaction.find({
        provider: 'flutterwave',
        type:     'credit',
        status:   'pending'
    }).populate('wallet_id');

    console.log(`Found ${pending.length} pending Flutterwave transactions\n`);

    if (pending.length === 0) {
        console.log('Nothing to do. Exiting.');
        process.exit(0);
    }

    let credited     = 0;
    let stillPending = 0;
    let failed       = 0;
    let alreadyDone  = 0;

    for (const tx of pending) {
        console.log(`\nChecking: ${tx.reference}`);
        console.log(`  Amount : ₦${tx.amount}`);
        console.log(`  Created: ${tx.created_at}`);
        console.log(`  User   : ${tx.user_id}`);

        let verified = false;
        let flwData  = null;
        let flwStatus = null;

        // ── Try by external_ref ─────────────────────────────────────────
        if (tx.external_ref) {
            try {
                const r = await flwService.verifyTransaction(tx.external_ref);
                flwStatus = r.data?.data?.status;
                console.log(`  FLW verify by external_ref: ${flwStatus}`);
                if (r.ok && flwStatus === 'successful') { verified = true; flwData = r.data.data; }
            } catch (e) {
                console.log(`  FLW verify by external_ref failed: ${e.message}`);
            }
        }

        // ── Try by tx_ref ───────────────────────────────────────────────
        if (!verified) {
            try {
                const r = await flwService.getTransactionByRef(tx.reference);
                flwStatus = r.data?.data?.status;
                console.log(`  FLW verify by tx_ref: ${flwStatus}`);
                if (r.ok && flwStatus === 'successful') { verified = true; flwData = r.data.data; }
                if (r.ok && flwStatus === 'failed')    {
                    tx.status        = 'failed';
                    tx.failed_reason = 'Reconciliation script: Flutterwave reports failed';
                    await tx.save();
                    console.log(`  → Marked as FAILED`);
                    failed++;
                    continue;
                }
            } catch (e) {
                console.log(`  FLW verify by tx_ref failed: ${e.message}`);
            }
        }

        if (!verified) {
            console.log(`  → Still pending (Flutterwave cannot confirm success)`);
            stillPending++;
            continue;
        }

        // ── Credit the wallet ───────────────────────────────────────────
        const session = await mongoose.startSession();
        try {
            session.startTransaction();

            const freshTx = await Transaction.findById(tx._id).session(session);
            if (freshTx.status !== 'pending') {
                await session.abortTransaction(); session.endSession();
                console.log(`  → Already ${freshTx.status} — skipping`);
                alreadyDone++;
                continue;
            }

            const wallet = await Wallet.findById(freshTx.wallet_id).session(session);
            if (!wallet) {
                await session.abortTransaction(); session.endSession();
                console.error(`  → WALLET NOT FOUND for transaction ${freshTx.reference}`);
                failed++;
                continue;
            }

            const balanceBefore = wallet.balance;

            freshTx.status       = 'success';
            freshTx.processed_at = new Date();
            freshTx.metadata     = {
                ...freshTx.metadata,
                flw_verification: flwData,
                verified_at:      new Date().toISOString(),
                verified_via:     'reconciliation_script'
            };
            await freshTx.save({ session });
            await wallet.credit(freshTx.amount, session);

            await session.commitTransaction();
            session.endSession();

            console.log(`  → ✅ CREDITED ₦${freshTx.amount}`);
            console.log(`     Balance: ₦${balanceBefore} → ₦${wallet.balance}`);
            credited++;

        } catch (innerErr) {
            await session.abortTransaction();
            session.endSession();
            console.error(`  → ERROR crediting wallet: ${innerErr.message}`);
            failed++;
        }
    }

    console.log('\n═══════════════════════════════════════');
    console.log('   Results');
    console.log('═══════════════════════════════════════');
    console.log(`  ✅ Credited    : ${credited}`);
    console.log(`  ⏳ Still pending: ${stillPending}`);
    console.log(`  ❌ Failed      : ${failed}`);
    console.log(`  ⏭  Already done: ${alreadyDone}`);
    console.log('═══════════════════════════════════════\n');

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});