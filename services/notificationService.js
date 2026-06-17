// backend/services/notificationService.js
const Notification = require('../models/Notification');
const emailService = require('./emailService');
const logger = require('../utils/logger');

class NotificationService {
  constructor() {
    logger.info('✅ NotificationService initialized');
  }

  /**
   * Create in-app notification
   * @param {string} userId - User ID
   * @param {string} type - Notification type
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {Object} data - Additional data
   * @returns {Promise<Object>}
   */
  async createNotification(userId, type, title, message, data = {}) {
    try {
      const notification = new Notification({
        userId,
        type,
        title,
        message,
        data
      });
      await notification.save();
      logger.info(`✅ In-app notification created:`, {
        userId,
        type,
        title
      });
      return notification;
    } catch (error) {
      logger.error('❌ Error creating notification:', error.message);
      throw error;
    }
  }

  /**
   * Send email notification
   */
  async sendEmail(to, subject, html, text = '') {
    if (process.env.E2E_EXPOSE_VERIFICATION_CODE === 'true') {
      logger.info('Skipping outbound notification email during E2E run', {
        to,
        subject
      });
      return true;
    }

    try {
      const result = await emailService.sendEmail(to, subject, html);
      if (!result || !result.success) {
        logger.warn('⚠️ Email not sent', {
          to,
          subject,
          error: result?.error || 'Unknown email error'
        });
        return false;
      }

      logger.info(`✅ Email sent successfully:`, {
        to,
        subject,
        messageId: result.messageId
      });
      return true;
    } catch (error) {
      logger.error('❌ Error sending email:', error.message);
      return false;
    }
  }

  /**
   * Send comprehensive notification (in-app + email)
   */
  async sendComprehensiveNotification(userId, type, title, message, data = {}, options = {}) {
    try {
      const { 
        sendEmail = true, 
        emailSubject, 
        emailHtml
      } = options;

      // Get user details
      const User = require('../models/User');
      const user = await User.findById(userId);
      if (!user) {
        logger.warn('⚠️ User not found for notification:', userId);
        return;
      }

      // Create in-app notification
      const notification = await this.createNotification(userId, type, title, message, data);

      // Send email if enabled and user has email
      if (sendEmail && user.email) {
        const subject = emailSubject || title;
        const html = emailHtml || `<p>${message}</p>`;
        await this.sendEmail(user.email, subject, html);
      }

      logger.info(`✅ Comprehensive notification sent:`, {
        userId,
        type,
        channels: {
          inApp: true,
          email: sendEmail && user.email ? true : false
        }
      });
      return notification;
    } catch (error) {
      logger.error('❌ Error sending comprehensive notification:', error.message);
      return null;
    }
  }

  /**
   * Notify when a new job is posted
   */
  /**
   * Notify when a new job is posted
   */
  async notifyJobPosted(job, client) {
    try {
      logger.info('📝 Job posted notification event:', { jobId: job._id, clientId: client._id });
      
      // Notify client that job is posted
      await this.sendComprehensiveNotification(
        client._id,
        'job',
        'Job Posted Successfully',
        `Your job "${job.title}" has been posted successfully.`,
        { jobId: job._id, jobTitle: job.title },
        {
          sendEmail: true,
          emailSubject: `📝 Job Posted: ${job.title}`,
          emailHtml: `
            <h2>Job Posted Successfully</h2>
            <p>Your job <strong>"${job.title}"</strong> has been posted on SkillAfrik.</p>
            <p>Freelancers will start applying soon. You'll be notified of new applications.</p>
            <p>Best regards,<br>SkillAfrik Team</p>
          `
        }
      );
    } catch (error) {
      logger.error('❌ Error in notifyJobPosted:', error.message);
    }
  }

  /**
   * Notify when a freelancer is assigned to a job
   */
  /**
   * Notify when a freelancer is assigned to a job
   */
  async notifyJobAssigned(job, freelancer, assignedByAdmin = false) {
    try {
      const assignerText = assignedByAdmin ? 'the admin' : 'the client';

      // Notify freelancer
      await this.sendComprehensiveNotification(
        freelancer._id,
        'job',
        assignedByAdmin ? 'Job Assigned To You' : "You're Hired",
        assignedByAdmin
          ? `You have been assigned to the job "${job.title}" by ${assignerText}.`
          : `You have been hired for "${job.title}".`,
        { jobId: job._id, jobTitle: job.title, budget: job.budget },
        {
          sendEmail: true,
          emailSubject: `🎯 Job Assigned: ${job.title}`,
          emailHtml: `
            <h2>Job Assignment</h2>
            <p>${assignedByAdmin ? 'You have been assigned to' : 'You have been hired for'} <strong>"${job.title}"</strong>.</p>
            <p><strong>Budget:</strong> ₦${job.budget}</p>
            <p>Please start working on it as soon as possible.</p>
            <p>Best regards,<br>SkillAfrik Team</p>
          `
        }
      );

      // Notify client (if assigned by admin)
      if (assignedByAdmin) {
        const clientUser = await require('../models/User').findById(job.clientId);
        if (clientUser) {
          await this.sendComprehensiveNotification(
            job.clientId,
            'job',
            'Freelancer Assigned',
            `${freelancer.firstName} ${freelancer.lastName} has been assigned to your job "${job.title}".`,
            { jobId: job._id, freelancerId: freelancer._id },
            {
              sendEmail: true,
              emailSubject: `✅ Freelancer Assigned: ${job.title}`,
              emailHtml: `
                <h2>Freelancer Assigned</h2>
                <p><strong>${freelancer.firstName} ${freelancer.lastName}</strong> has been assigned to your job "${job.title}".</p>
                <p>The freelancer will start working on your project shortly.</p>
                <p>Best regards,<br>SkillAfrik Team</p>
              `
            }
          );
        }
      }
    } catch (error) {
      logger.error('❌ Error in notifyJobAssigned:', error.message);
    }
  }

  /**
   * Notify client that a freelancer was hired for their job.
   */
  async notifyClientFreelancerHired(job, freelancer) {
    try {
      const freelancerName = [freelancer.firstName, freelancer.lastName].filter(Boolean).join(' ') || 'A freelancer';
      await this.sendComprehensiveNotification(
        job.clientId,
        'job',
        'Freelancer Hired',
        `You hired ${freelancerName} for "${job.title}". The job is now assigned and in progress.`,
        { jobId: job._id, freelancerId: freelancer._id, jobTitle: job.title },
        {
          sendEmail: true,
          emailSubject: `Hired: ${job.title}`,
          emailHtml: `
            <h2>Freelancer Hired</h2>
            <p>You hired <strong>${freelancerName}</strong> for <strong>"${job.title}"</strong>.</p>
            <p>Fund escrow from your wallet when you are ready to begin.</p>
            <p>Best regards,<br>SkillAfrik Team</p>
          `,
        }
      );
    } catch (error) {
      logger.error('❌ Error in notifyClientFreelancerHired:', error.message);
    }
  }

  /**
   * Notify an applicant they were not selected after another freelancer was hired.
   */
  async notifyEscrowSecured(escrow, job) {
    try {
      const jobTitle = job?.title || 'your job';
      await this.sendComprehensiveNotification(
        escrow.freelancerId,
        'payment',
        'Payment Secured',
        `Funds for "${jobTitle}" are now secured in escrow. You can begin work with confidence.`,
        { escrowId: escrow._id, jobId: escrow.jobId, jobTitle, status: 'FUNDED' },
        {
          sendEmail: true,
          emailSubject: `Payment Secured: ${jobTitle}`,
          emailHtml: `
            <h2>Payment Secured</h2>
            <p>Great news — the client has funded escrow for <strong>"${jobTitle}"</strong>.</p>
            <p><strong>Amount secured:</strong> ₦${Number(escrow.amount || 0).toLocaleString()}</p>
            <p>You can begin work knowing payment is protected on SkillAfrik.</p>
            <p>Best regards,<br>SkillAfrik Team</p>
          `,
        }
      );

      await this.sendComprehensiveNotification(
        escrow.clientId,
        'payment',
        'Escrow Funded',
        `Your escrow payment for "${jobTitle}" is secured. The freelancer has been notified.`,
        { escrowId: escrow._id, jobId: escrow.jobId, jobTitle, status: 'FUNDED' },
        {
          sendEmail: false,
        }
      );
    } catch (error) {
      logger.error('❌ Error in notifyEscrowSecured:', error.message);
    }
  }

  async notifyApplicantNotSelected(job, freelancerId) {
    try {
      await this.sendComprehensiveNotification(
        freelancerId,
        'job',
        'Not Selected',
        `Thank you for applying to "${job.title}". The client hired another freelancer, but your application remains on record.`,
        { jobId: job._id, jobTitle: job.title, status: 'not_selected' },
        {
          sendEmail: true,
          emailSubject: `Application update: ${job.title}`,
          emailHtml: `
            <h2>Not Selected</h2>
            <p>Thank you for applying to <strong>"${job.title}"</strong>.</p>
            <p>The client hired another freelancer for this role. Your application has been kept on record.</p>
            <p>Best regards,<br>SkillAfrik Team</p>
          `,
        }
      );
    } catch (error) {
      logger.error('❌ Error in notifyApplicantNotSelected:', error.message);
    }
  }

  /**
   * Notify when a freelancer applies to a job
   */
  /**
   * Notify when a freelancer applies to a job
   */
  async notifyJobApplication(job, freelancer, io = null) {
    try {
      const notification = await this.sendComprehensiveNotification(
        job.clientId,
        'job',
        'New Job Application',
        `${freelancer.firstName} ${freelancer.lastName} applied to your job "${job.title}".`,
        { jobId: job._id, freelancerId: freelancer._id, type: 'application_received' },
        {
          sendEmail: true,
          emailSubject: `📋 New Application: ${job.title}`,
          emailHtml: `
            <h2>New Application Received</h2>
            <p><strong>${freelancer.firstName} ${freelancer.lastName}</strong> has applied to your job "${job.title}".</p>
            <p>View their profile and decide if they're the right fit for your project.</p>
            <p>Best regards,<br>SkillAfrik Team</p>
          `
        }
      );

      if (io && notification) {
        io.to(`user:${job.clientId}`).emit('notification:new', {
          notification: {
            _id: notification._id,
            title: notification.title,
            message: notification.message,
            type: notification.type,
            read: false,
            createdAt: notification.createdAt,
            data: notification.data,
          },
        });
      }

      return notification;
    } catch (error) {
      logger.error('❌ Error in notifyJobApplication:', error.message);
      return null;
    }
  }

  /**
   * Notify when a proposal/application is accepted
   */
  /**
   * Notify when a proposal/application is accepted
   */
  async notifyJobAccepted(job, freelancer) {
    try {
      // Notify freelancer that job is accepted
      await this.sendComprehensiveNotification(
        freelancer._id,
        'job',
        'Job Accepted',
        `Your application for "${job.title}" has been accepted!`,
        { jobId: job._id, jobTitle: job.title },
        {
          sendEmail: true,
          emailSubject: `🎉 Application Accepted: ${job.title}`,
          emailHtml: `
            <h2>Congratulations! 🎉</h2>
            <p>Your application for <strong>"${job.title}"</strong> has been accepted!</p>
            <p>You can now start working on the project. Check the job details for more information.</p>
            <p>Best regards,<br>SkillAfrik Team</p>
          `
        }
      );
    } catch (error) {
      logger.error('❌ Error in notifyJobAccepted:', error.message);
    }
  }

  /**
   * Notify when a job is completed
   */
  /**
   * Notify when a job is completed
   */
  async notifyJobCompleted(job, freelancer) {
    try {
      // Notify client that job is completed
      await this.sendComprehensiveNotification(
        job.clientId,
        'job',
        'Job Completed',
        `The job "${job.title}" has been marked as completed.`,
        { jobId: job._id, jobTitle: job.title },
        {
          sendEmail: true,
          emailSubject: `✅ Job Completed: ${job.title}`,
          emailHtml: `
            <h2>Job Completed</h2>
            <p>The freelancer has marked <strong>"${job.title}"</strong> as completed.</p>
            <p>Please review the work and release payment if satisfied.</p>
            <p>Best regards,<br>SkillAfrik Team</p>
          `
        }
      );
    } catch (error) {
      logger.error('❌ Error in notifyJobCompleted:', error.message);
    }
  }

  async notifyWorkSubmitted(job, freelancer) {
    try {
      await this.sendComprehensiveNotification(
        job.clientId,
        'job',
        'Work Submitted',
        `${freelancer.firstName} ${freelancer.lastName} submitted work for "${job.title}".`,
        { jobId: job._id, jobTitle: job.title, freelancerId: freelancer._id },
        {
          sendEmail: true,
          emailSubject: `Work Submitted: ${job.title}`,
          emailHtml: `
            <h2>Work Submitted</h2>
            <p><strong>${freelancer.firstName} ${freelancer.lastName}</strong> submitted work for <strong>"${job.title}"</strong>.</p>
            <p>Please review the delivery and release payment if satisfied.</p>
            <p>Best regards,<br>SkillAfrik Team</p>
          `
        }
      );
    } catch (error) {
      logger.error('Error in notifyWorkSubmitted:', error.message);
    }
  }

  async notifyPaymentReleased(job, freelancerId, amount) {
    try {
      const jobDoc = job && job.title ? job : await require('../models/Job').findById(job);
      const jobTitle = jobDoc?.title || 'your job';
      const formattedAmount = `₦${Number(amount || 0).toLocaleString()}`;

      await this.sendComprehensiveNotification(
        freelancerId,
        'payment',
        'Payment Released',
        `Payment for "${jobTitle}" has been released to your wallet (${formattedAmount}).`,
        { jobId: jobDoc?._id || job, amount },
        {
          sendEmail: true,
          emailSubject: `Payment Released: ${jobTitle}`,
          emailHtml: `
            <h2>Payment Released</h2>
            <p>Your payment for <strong>"${jobTitle}"</strong> has been released to your SkillAfrik wallet.</p>
            <p><strong>Amount:</strong> ${formattedAmount}</p>
            <p>Best regards,<br>SkillAfrik Team</p>
          `,
        }
      );

      if (jobDoc?.clientId) {
        await this.sendComprehensiveNotification(
          jobDoc.clientId,
          'job',
          'Work Approved',
          `You approved work for "${jobTitle}" and released ${formattedAmount} to the freelancer.`,
          { jobId: jobDoc._id, amount },
          { sendEmail: false }
        );
      }
    } catch (error) {
      logger.error('Error in notifyPaymentReleased:', error.message);
    }
  }

  /**
   * Get email notification service status
   */
  getServiceStatus() {
    return {
      email: {
        available: !!emailService.transporter,
        provider: 'SMTP',
        from: process.env.SMTP_EMAIL || process.env.SMTP_USER
      },
      timestamp: new Date()
    };
  }
}

module.exports = new NotificationService();
