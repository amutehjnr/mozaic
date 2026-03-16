require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const flash = require('express-flash');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');

// Import middleware
const rateLimiter = require('./src/middleware/rateLimiter');
const { errorHandler } = require('./src/middleware/errorHandler');
const { setupCsrf, csrfProtection, generateToken } = require('./src/middleware/csrf');
const logger = require('./src/utils/logger');
const connectDB = require('./src/config/database');

const app = express();

// ==================== Error Handling ====================
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
    logger.error('UNCAUGHT EXCEPTION!', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason);
    logger.error('UNHANDLED REJECTION!', reason);
});

// ==================== Security & Middleware ====================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https://cdn.jsdelivr.net"],
            connectSrc: ["'self'", "https://api.flutterwave.com", "https://api.vtpass.com"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://mozaic-eomm.onrender.com', process.env.BASE_URL].filter(Boolean)
        : ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
    optionsSuccessStatus: 200
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== MongoDB Connection ====================
console.log('🔄 Connecting to MongoDB...');
connectDB().then(() => {
    console.log('✅ Database connected successfully');

    // ==================== Register Models ====================
    try {
        require('./src/models/User');
        require('./src/models/PasswordReset');
        require('./src/models/Wallet');
        require('./src/models/Transaction');
        require('./src/models/KycProfile');
        require('./src/models/Beneficiary');
        require('./src/models/Referral');
        console.log('✅ All models registered');
    } catch (modelError) {
        console.error('❌ Error registering models:', modelError);
    }

    // ==================== Session ====================
    const sessionConfig = {
        secret: process.env.SESSION_SECRET || 'dev-secret-key',
        resave: false,
        saveUninitialized: true,
        store: MongoStore.create({
            mongoUrl: process.env.MONGODB_URI,
            collectionName: 'sessions',
            ttl: 24 * 60 * 60,
            autoRemove: 'native',
            touchAfter: 24 * 3600
        }),
        cookie: {
            maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
        },
        name: 'mozaic.sid',
        rolling: true,
        proxy: true
    };
    if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
    app.use(session(sessionConfig));
    console.log('✅ Session initialized');

    // ==================== Flash ====================
    app.use(flash());

    // ==================== View Engine ====================
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    // ==================== Global Middleware ====================
    app.use((req, res, next) => {
        res.locals.user = req.session?.user || null;
        res.locals.currentUrl = req.originalUrl;
        res.locals.messages = req.flash ? req.flash() : {};
        res.locals.queryParams = req.query;
        res.locals.env = process.env.NODE_ENV;
        res.locals.baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
        res.locals.nonce = crypto.randomBytes(16).toString('base64');
        res.locals.bodyClass = '';
        res.locals.formData = {};
        res.locals.csrfToken = '';
        res.locals.url = (path) => path ? (path.startsWith('/') ? path : '/' + path) : '';
        next();
    });

    // ==================== Rate Limiting ====================
    app.use('/api/', rateLimiter.api);
    app.use('/auth/', rateLimiter.auth);

    // ==================== CSRF Protection ====================
    app.use(setupCsrf());

    // Optional endpoint to fetch CSRF token
    app.get('/api/csrf', (req, res) => {
        const token = generateToken();
        res.cookie('XSRF-TOKEN', token, {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000
        });
        res.json({ csrfToken: token });
    });

    // ==================== Routes ====================
    app.get('/', (req, res) => {
        res.render('home', { 
            title: 'MozAic - Buy Data, Airtime & Pay Bills',
            bodyClass: 'home-page',
            flashMessages: req.flash()
        });
    });

    // ==================== Diagnostic Routes ====================
    app.get('/debug/env', (req, res) => {
        res.json({
            NODE_ENV: process.env.NODE_ENV,
            BASE_URL: process.env.BASE_URL,
            hasSession: !!req.session,
            sessionID: req.session?.id,
            hasCsrfSecret: !!req.session?.csrfSecret,
            cookies: req.cookies
        });
    });

    app.get('/debug/db', async (req, res) => {
        try {
            const state = mongoose.connection.readyState;
            const stateMap = {0:'disconnected',1:'connected',2:'connecting',3:'disconnecting'};
            let pingResult = null, collections = [];
            if(state === 1){
                pingResult = await mongoose.connection.db.admin().ping();
                collections = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name);
            }
            res.json({
                connectionState: stateMap[state] || 'unknown',
                readyState: state,
                databaseName: mongoose.connection.name,
                host: mongoose.connection.host,
                port: mongoose.connection.port,
                ping: pingResult,
                collections,
                models: Object.keys(mongoose.models)
            });
        } catch(err){
            res.status(500).json({ error: err.message, stack: err.stack });
        }
    });

    app.get('/debug/uri', (req,res)=>{
        const uri = process.env.MONGODB_URI || '';
        const safeUri = uri.replace(/:[^:@]+@/, ':****@');
        res.json({ exists: !!process.env.MONGODB_URI, safeUri, length: uri.length, format: uri.startsWith('mongodb+srv://')?'SRV':'Standard' });
    });

    app.get('/ping', (req,res)=>res.json({ pong:true, time: Date.now() }));

    // ==================== Load Routes ====================
    try { app.use('/auth', require('./src/routes/web/auth')); console.log('✅ Auth routes loaded'); } 
    catch(e){ console.error('❌ Failed auth routes:', e.message); }
    try { app.use('/dashboard', require('./src/routes/web/dashboard')); console.log('✅ Dashboard routes loaded'); } 
    catch(e){ console.error('❌ Failed dashboard routes:', e.message); }
    try { app.use('/api', require('./src/routes/api/index')); console.log('✅ API routes loaded'); } 
    catch(e){ console.error('❌ Failed API routes:', e.message); }

    app.get('/test', (req,res)=>res.send('✅ Server test route working!'));

    // ==================== 404 Handler ====================
    app.use((req,res)=>{
        if(req.xhr || req.path.startsWith('/api/')) return res.status(404).json({ ok:false, error:'Endpoint not found' });
        res.status(404).render('error/404',{ title:'Page Not Found', bodyClass:'error-page', flashMessages:req.flash?req.flash():{} });
    });

    // ==================== Error Handler ====================
    app.use(errorHandler);

    // ==================== Start Server ====================
    const PORT = process.env.PORT || 3000;
    const server = http.createServer(app);
    server.listen(PORT,'0.0.0.0',()=>console.log(`✅ Server running on port ${PORT}`));

    process.on('SIGTERM',()=>{ server.close(()=>mongoose.connection.close()); });

}).catch(err => {
    console.error('❌ DATABASE CONNECTION FAILED:', err);
    process.exit(1);
});

module.exports = app;