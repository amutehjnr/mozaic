#!/usr/bin/env node
/**
 * scripts/create-admin.js
 *
 * Creates a new admin user or promotes an existing user to admin.
 *
 * Usage (interactive):
 *   node scripts/create-admin.js
 *
 * Usage (non-interactive, all flags):
 *   node scripts/create-admin.js --email admin@example.com --password Secret123 --name "Admin" --role admin
 *
 * Promote existing user:
 *   node scripts/create-admin.js --email existing@example.com --promote
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const readline = require('readline');
const crypto   = require('crypto');

// ── Inline models ─────────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
    uid:           { type: String, default: () => crypto.randomBytes(16).toString('hex') },
    name:          { type: String, required: true, trim: true },
    email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone:         { type: String, sparse: true },
    password_hash: { type: String, required: true },
    referral_code: { type: String, unique: true, sparse: true },
    role:          { type: String, enum: ['user', 'admin', 'superadmin'], default: 'user' },
    isActive:      { type: Boolean, default: true },
    lastLogin:     Date,
    loginCount:    { type: Number, default: 0 },
    preferences:   { type: mongoose.Schema.Types.Mixed, default: {} },
    metadata:      { type: mongoose.Schema.Types.Mixed }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const walletSchema = new mongoose.Schema({
    user_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    balance:  { type: Number, default: 0 },
    currency: { type: String, default: 'NGN' },
    status:   { type: String, enum: ['active', 'frozen', 'closed', 'pending'], default: 'active' },
    tier:     { type: String, default: 'basic' }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const User   = mongoose.models.User   || mongoose.model('User',   userSchema);
const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', walletSchema);

// ── Colours ───────────────────────────────────────────────────────────────────

const c = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    red:    '\x1b[31m',
    cyan:   '\x1b[36m',
    grey:   '\x1b[90m',
};
const ok   = (msg) => console.log(`${c.green}✔${c.reset}  ${msg}`);
const fail = (msg) => console.log(`${c.red}✖${c.reset}  ${msg}`);
const inf  = (msg) => console.log(`${c.cyan}ℹ${c.reset}  ${msg}`);
const warn = (msg) => console.log(`${c.yellow}⚠${c.reset}  ${msg}`);
const hr   = ()    => console.log(`${c.grey}${'─'.repeat(56)}${c.reset}`);

// ── Simple readline prompt (no raw mode — works on Windows) ───────────────────

function ask(rl, question, defaultVal) {
    const display = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
    return new Promise(resolve => {
        rl.question(display, answer => {
            const val = (answer || '').trim();
            resolve(val === '' ? (defaultVal || '') : val);
        });
    });
}

// ── CLI flags ─────────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const out  = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            const next = args[i + 1];
            out[key] = (next && !next.startsWith('--')) ? args[++i] : true;
        }
    }
    return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n${c.bold}${c.cyan}MozAic — Admin User Setup${c.reset}`);
    hr();

    if (!process.env.MONGODB_URI) {
        fail('MONGODB_URI is not set in your .env file');
        process.exit(1);
    }

    inf('Connecting to MongoDB...');
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        ok(`Connected  →  ${mongoose.connection.host}  (${mongoose.connection.name})`);
    } catch (e) {
        fail(`Connection failed: ${e.message}`);
        process.exit(1);
    }

    hr();

    const flags = parseArgs();

    // Create readline interface once and reuse it for all prompts
    const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
    });

    // ── Collect email ──────────────────────────────────────────
    const email = (flags.email || await ask(rl, 'Admin email address', '')).toLowerCase().trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        fail(`"${email}" is not a valid email address`);
        rl.close(); await mongoose.disconnect(); process.exit(1);
    }

    // ── Check if user already exists ──────────────────────────
    const existing = await User.findOne({ email });

    if (existing) {
        warn(`User already exists: "${existing.name}"  [current role: ${existing.role}]`);

        const answer = flags.promote
            ? 'yes'
            : await ask(rl, 'Promote this user to admin? (yes / no)', 'yes');

        if (answer.toLowerCase().startsWith('y')) {
            const role = flags.role
                ? flags.role
                : await ask(rl, 'New role (admin / superadmin)', 'admin');

            rl.close();

            existing.role     = ['admin', 'superadmin'].includes(role) ? role : 'admin';
            existing.isActive = true;
            await existing.save();

            hr();
            ok(`"${existing.name}" promoted to ${c.bold}${existing.role}${c.reset}`);
            printSummary(existing, null);

        } else {
            inf('No changes made.');
            rl.close();
        }

        await mongoose.disconnect();
        process.exit(0);
    }

    // ── New user — collect remaining fields ────────────────────
    const name = (flags.name || await ask(rl, 'Display name', 'Admin')).trim();

    // Password — shown as plain text (avoids Windows raw-mode freeze)
    console.log(`${c.yellow}Note: password will be visible as you type (terminal limitation)${c.reset}`);
    const password = flags.password || await ask(rl, 'Password (min 6 characters)', '');

    if (!password || password.length < 6) {
        fail('Password must be at least 6 characters');
        rl.close(); await mongoose.disconnect(); process.exit(1);
    }

    const roleInput = flags.role || await ask(rl, 'Role (admin / superadmin)', 'admin');
    const role      = ['admin', 'superadmin'].includes(roleInput.toLowerCase())
        ? roleInput.toLowerCase()
        : 'admin';

    rl.close();
    hr();

    // ── Hash password ──────────────────────────────────────────
    inf('Hashing password...');
    const passwordHash = await bcrypt.hash(password, 12);
    ok('Password hashed  (bcrypt, 12 rounds)');

    // ── Generate referral code ─────────────────────────────────
    const base        = name.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase().padEnd(3, 'ADM');
    const referralCode = base + crypto.randomBytes(3).toString('hex').toUpperCase();

    // ── Create user ────────────────────────────────────────────
    inf('Creating user...');
    let user;
    try {
        user = await User.create({
            name,
            email,
            password_hash: passwordHash,
            role,
            referral_code: referralCode,
            isActive: true,
        });
        ok(`User document created  [_id: ${user._id}]`);
    } catch (e) {
        fail(`Failed to create user: ${e.message}`);
        await mongoose.disconnect();
        process.exit(1);
    }

    // ── Create wallet ──────────────────────────────────────────
    inf('Creating wallet...');
    try {
        await Wallet.create({
            user_id:  user._id,
            balance:  0,
            currency: 'NGN',
            status:   'active',
            tier:     'platinum',
        });
        ok('Wallet created  [tier: platinum]');
    } catch (e) {
        warn(`Wallet creation skipped (may already exist): ${e.message}`);
    }

    hr();
    ok(`${c.bold}Admin account created successfully!${c.reset}`);
    printSummary(user, password);

    await mongoose.disconnect();
    inf('Done.\n');
    process.exit(0);
}

function printSummary(user, password) {
    console.log('');
    console.log(`  ${c.grey}Name     :${c.reset}  ${user.name}`);
    console.log(`  ${c.grey}Email    :${c.reset}  ${user.email}`);
    if (password) {
        console.log(`  ${c.grey}Password :${c.reset}  ${password}`);
    }
    console.log(`  ${c.grey}Role     :${c.reset}  ${c.bold}${c.cyan}${user.role}${c.reset}`);
    console.log(`  ${c.grey}User ID  :${c.reset}  ${user._id}`);
    console.log('');
    console.log(`  ${c.yellow}Login at /auth/login then go to /admin/dashboard${c.reset}`);
    console.log(`  ${c.yellow}⚠  Save these credentials somewhere safe.${c.reset}`);
    console.log('');
}

main().catch(e => {
    console.error(`\n${c.red}Fatal:${c.reset}`, e.message);
    mongoose.disconnect().finally(() => process.exit(1));
});