/**
 * debug-flw-response.js
 *
 * Dumps the raw Flutterwave API response for the two stuck transactions
 * so we can see the exact response structure and fix the reconciler.
 *
 * Run: node scripts/debug-flw-response.js
 */

require('dotenv').config();
const axios = require('axios');
const connectDB = require('../src/config/database');
require('../src/models/Transaction');
const Transaction = require('../src/models/Transaction');

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const BASE_URL = process.env.FLW_BASE_URL || 'https://api.flutterwave.com/v3';

if (!FLW_SECRET_KEY) {
    console.error('❌ FLW_SECRET_KEY is not set in .env');
    process.exit(1);
}

const client = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${FLW_SECRET_KEY}`
    },
    timeout: 30000
});

async function dumpRaw(label, url) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Calling: GET ${url}`);
    console.log('─'.repeat(60));
    try {
        const res = await client.get(url);
        console.log(`HTTP Status : ${res.status}`);
        console.log(`Full Response Body:\n`);
        console.log(JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.log(`HTTP Error  : ${err.response?.status}`);
        console.log(`Error Body  :\n`);
        console.log(JSON.stringify(err.response?.data, null, 2));
        console.log(`Message: ${err.message}`);
    }
}

async function main() {
    await connectDB();

    const pendingTxs = await Transaction.find({
        provider: 'flutterwave',
        type:     'credit',
        status:   'pending'
    });

    console.log(`\nFound ${pendingTxs.length} pending transactions\n`);

    for (const tx of pendingTxs) {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`Transaction Reference : ${tx.reference}`);
        console.log(`Amount                : ₦${tx.amount}`);
        console.log(`External Ref          : ${tx.external_ref || 'none'}`);
        console.log(`Created               : ${tx.created_at}`);
        console.log(`Metadata              :`);
        console.log(JSON.stringify(tx.metadata, null, 2));

        // Test 1: by_ref endpoint
        await dumpRaw('by_ref', `/transactions/by_ref/${tx.reference}`);

        // Test 2: if external_ref exists, verify by ID
        if (tx.external_ref) {
            await dumpRaw('verify_by_id', `/transactions/${tx.external_ref}/verify`);
        }
    }

    // Also dump a direct search by amount+date range
    console.log(`\n${'═'.repeat(60)}`);
    console.log('Fetching recent Flutterwave transactions (last 7 days):');
    await dumpRaw('recent_transactions',
        '/transactions?from=2026-03-10&to=2026-03-17&currency=NGN&count=20'
    );

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});