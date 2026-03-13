// test-env.js
require('dotenv').config();
const mongoose = require('mongoose');

console.log('🔍 Checking environment variables:');
console.log('MONGODB_URI exists?', process.env.MONGODB_URI ? 'YES ✅' : 'NO ❌');

if (process.env.MONGODB_URI) {
    console.log('Connection string starts with:', process.env.MONGODB_URI.substring(0, 25));
    
    mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000,
        family: 4
    })
    .then(() => {
        console.log('✅ Successfully connected to MongoDB!');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Connection failed:');
        console.error('Error code:', err.code);
        console.error('Error message:', err.message);
        process.exit(1);
    });
} else {
    console.log('❌ MONGODB_URI is not defined in .env file');
    console.log('Please check your .env file exists and contains MONGODB_URI');
}