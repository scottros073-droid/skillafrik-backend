// backend/services/emailService.js
const logger = require('../utils/logger');
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (error) {
  logger.warn('Nodemailer not installed. Email functionality will be logged only.');
  nodemailer = null;
}

class EmailService {
  constructor() {
    if (nodemailer) {
      try {
        const smtpService = process.env.SMTP_SERVICE;
        const smtpHost = process.env.SMTP_HOST;
        const smtpUser = process.env.SMTP_USER;
        const smtpEmail = process.env.SMTP_EMAIL;
        const smtpPassword = process.env.SMTP_PASSWORD;
        
        const hasSmtpConfig = Boolean(
          (smtpHost || smtpService) &&
          (smtpUser || smtpEmail) &&
          smtpPassword
        );

        logger.info('Email service initialization', {
          hasConfig: hasSmtpConfig,
          smtpHost: smtpHost ? '***configured***' : 'missing',
          smtpService: smtpService ? '***configured***' : 'missing',
          smtpUser: smtpUser ? '***configured***' : 'missing',
          smtpEmail: smtpEmail ? '***configured***' : 'missing',
          smtpPassword: smtpPassword ? '***configured***' : 'missing'
        });

        if (!hasSmtpConfig) {
          logger.warn('SMTP is not fully configured. Email functionality will be logged only.');
          this.transporter = null;
          this.isGmail = false;
          return;
        }

        const isGmail = smtpHost === 'smtp.gmail.com' || smtpService === 'gmail';
        const authUser = smtpUser;
        const authPass = smtpPassword;

        const transportOptions = isGmail
          ? {
              service: smtpService || 'gmail',
              connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 5000),
              greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 5000),
              socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 8000),
              auth: {
                user: authUser,
                pass: authPass,
              },
            }
          : {
              host: smtpHost,
              port: parseInt(process.env.SMTP_PORT, 10) || 587,
              secure: process.env.SMTP_PORT === '465',
              connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 5000),
              greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 5000),
              socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 8000),
              auth: {
                user: smtpEmail || authUser,
                pass: authPass,
              },
            };

        logger.info('Creating email transporter', {
          service: isGmail ? 'gmail' : smtpHost,
          authUser: authUser ? '***configured***' : 'missing'
        });

        this.transporter = nodemailer.createTransport(transportOptions);
        this.isGmail = isGmail;

        // Verify connection asynchronously (non-blocking)
        setImmediate(() => {
          this.transporter.verify((verifyError, success) => {
            if (verifyError) {
              logger.error('❌ Email transporter verification failed', { 
                error: verifyError.message,
                code: verifyError.code 
              });
            } else {
              logger.info('✅ Email transporter verified', { 
                service: isGmail ? 'gmail' : smtpHost,
                ready: !!success
              });
            }
          });
        });

        logger.info('✅ Email service initialized', { provider: isGmail ? 'Gmail' : 'SMTP' });
      } catch (error) {
        logger.error('Failed to create email transporter', { 
          error: error.message,
          stack: error.stack 
        });
        this.transporter = null;
        this.isGmail = false;
      }
    } else {
      logger.warn('Nodemailer not available - email functionality disabled');
      this.transporter = null;
      this.isGmail = false;
    }
  }

  async sendEmail(to, subject, html, retries = Number(process.env.SMTP_SEND_RETRIES || 1)) {
    if (!this.transporter) {
      logger.info('📧 Email logged (SMTP not configured)', { to, subject });
      return { success: true, mode: 'log', message: 'Email logged (SMTP not configured)' };
    }

    logger.info('📨 Attempting to send email', { to, subject, attempt: 1, maxRetries: retries });

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const mailOptions = {
          from: this.isGmail ? process.env.SMTP_USER : process.env.SENDER_EMAIL || process.env.SMTP_EMAIL || process.env.SMTP_USER,
          to,
          subject,
          html,
        };

        const info = await this.transporter.sendMail(mailOptions);
        logger.info('✅ Email sent successfully', { 
          messageId: info.messageId, 
          to,
          attempt,
          response: info.response 
        });
        return { success: true, messageId: info.messageId, attempt };
      } catch (error) {
        const isLastAttempt = attempt === retries;
        logger.warn(`⚠️  Email sending failed (attempt ${attempt}/${retries})`, { 
          error: error.message,
          code: error.code,
          statusCode: error.statusCode,
          to,
          isLastAttempt,
          stack: isLastAttempt ? error.stack : undefined
        });
        
        if (attempt < retries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          logger.info(`Retrying email send in ${delay}ms...`, { attempt, nextAttempt: attempt + 1 });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    logger.error('❌ Email sending failed after all retries', { to, subject, maxRetries: retries });
    return { success: false, error: 'Email sending failed after retries' };
  }

  async sendPasswordResetEmail(email, resetToken) {
    const frontendUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.APP_URL || process.env.PUBLIC_APP_URL;
    if (!frontendUrl) {
      throw new Error('FRONTEND_URL is required to build password reset email links');
    }
    const resetUrl = `${frontendUrl.replace(/\/+$/, '')}/reset-password/${resetToken}`;
    const subject = 'Password Reset Request - SkillAfrik';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Password Reset Request</h2>
        <p>You requested a password reset for your SkillAfrik account.</p>
        <p>Click the link below to reset your password:</p>
        <a href="${resetUrl}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0;">Reset Password</a>
        <p>If you didn't request this, please ignore this email.</p>
        <p>This link will expire in 60 minutes.</p>
        <p>Best regards,<br>SkillAfrik Team</p>
      </div>
    `;

    return this.sendEmail(email, subject, html);
  }

  async sendVerificationEmail(email, verificationToken) {
    const frontendUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.APP_URL || process.env.PUBLIC_APP_URL;
    const backendUrl = process.env.BASE_URL || process.env.BACKEND_URL || process.env.API_URL;
    if (!frontendUrl && !backendUrl) {
      throw new Error('FRONTEND_URL or BASE_URL is required to build verification email links');
    }

    const appUrl = (frontendUrl || '').replace(/\/+$/, '');
    const apiUrl = (backendUrl || '').replace(/\/+$/, '');
    const verificationUrl = appUrl
      ? `${appUrl}/verify/${encodeURIComponent(verificationToken)}`
      : `${apiUrl}/api/auth/verify/${encodeURIComponent(verificationToken)}`;

    const subject = 'Verify your SkillAfrik email';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Verify your email</h2>
        <p>Welcome to SkillAfrik. Please verify this email address to activate your account.</p>
        <p>Your verification code is:</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${verificationToken}</p>
        <a href="${verificationUrl}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0;">Verify Email</a>
        <p>This code expires in 30 minutes. Ignore this email if you did not create an account.</p>
      </div>
    `;

    return this.sendEmail(email, subject, html);
  }
}

module.exports = new EmailService();
