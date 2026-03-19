const nodemailer = require('nodemailer');

class EmailService {
    constructor() {
        if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            this.transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                }
            });
            this.from = process.env.EMAIL_USER;
        } else {
            this.transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.ethereal.email',
                port: process.env.SMTP_PORT || 587,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });
            this.from = process.env.SMTP_FROM || 'alerts@iot-dashboard.local';
        }
    }

    async sendAlertEmail(to, deviceName, type, value, threshold) {
        try {
            const subject = `⚠️ Alert from ${deviceName}: ${type.toUpperCase()}`;
            const text = `Device "${deviceName}" triggered an alert.\n\nType: ${type}\nValue: ${value}\nThreshold was: ${threshold}\n\nPlease check your dashboard for details.`;
            
            const info = await this.transporter.sendMail({
                from: this.from,
                to,
                subject,
                text
            });
            
            console.log(`[Email] Alert email sent to ${to}: ${info.messageId}`);
            
            // Helpful if using ethereal.email for local testing
            if (process.env.SMTP_HOST === 'smtp.ethereal.email') {
                console.log(`[Email] Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
            }
        } catch (error) {
            console.error('[Email] Error sending alert email:', error);
        }
    }
}

module.exports = new EmailService();
