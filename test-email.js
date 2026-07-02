// test-email.js
import { env } from './src/config/env.js';
import nodemailer from 'nodemailer';

async function testEmail() {
    console.log('📧 Testing Email Configuration...');
    console.log('SMTP Host:', env.email.host);
    console.log('SMTP Port:', env.email.port);
    console.log('SMTP User:', env.email.user);
    console.log('SMTP From:', env.email.from);
    console.log('SMTP Enabled:', env.email.enabled);
    
    if (!env.email.enabled) {
        console.log('❌ SMTP is not properly configured!');
        console.log('Please check your SMTP environment variables in Railway.');
        return;
    }
    
    try {
        // Create transporter
        const transporter = nodemailer.createTransport({
            host: env.email.host,
            port: env.email.port,
            secure: env.email.secure || false,
            auth: {
                user: env.email.user,
                pass: env.email.pass
            },
            debug: true // Enable debug output
        });
        
        // Verify connection
        console.log('🔌 Verifying SMTP connection...');
        await transporter.verify();
        console.log('✅ SMTP Connection successful!');
        
        // Send test email
        console.log('📤 Sending test email...');
        const info = await transporter.sendMail({
            from: env.email.from,
            to: env.email.user, // Send to yourself
            subject: 'Test Email from Railway',
            html: '<h1>✅ Your email configuration is working!</h1><p>This is a test email sent from your Railway deployment.</p>'
        });
        
        console.log('✅ Test email sent successfully!');
        console.log('📧 Message ID:', info.messageId);
        console.log('📧 Message URL:', info.response);
    } catch (error) {
        console.error('❌ Email test failed:');
        console.error('Error Message:', error.message);
        console.error('Error Code:', error.code);
        
        if (error.code === 'ECONNECTION' || error.code === 'ESOCKET') {
            console.error('\n🔴 Railway is likely blocking SMTP ports (465, 587).');
            console.error('📌 Solution: Use a transactional email API instead:');
            console.error('   - Resend (resend.com) - 100 emails/day free');
            console.error('   - SendGrid - 100 emails/day free');
            console.error('   - Mailgun - 5,000 emails/month free');
        } else if (error.code === 'EAUTH') {
            console.error('\n🔴 Authentication failed. Check your SMTP credentials:');
            console.error('   - SMTP User:', env.email.user);
            console.error('   - SMTP Pass:', env.email.pass ? '✅ Set' : '❌ Missing');
            console.error('   - If using Gmail, ensure you have an App Password set up.');
        }
    }
}

testEmail();