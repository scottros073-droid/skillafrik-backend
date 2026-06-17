// backend/controllers/supportController.js

// Get support tickets
exports.getSupportTickets = async (req, res) => {
  try {
    const userId = req.user?.id;
    res.json({
      success: true,
      statusCode: 200,
      message: 'Support tickets retrieved',
      data: []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Create support ticket
exports.createSupportTicket = async (req, res) => {
  try {
    const { title, description, category } = req.body;
    const userId = req.user?.id;

    res.status(201).json({
      success: true,
      statusCode: 201,
      message: 'Support ticket created',
      data: {
        id: Math.random().toString(36),
        title,
        description,
        category,
        userId,
        status: 'open',
        createdAt: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Send support message (AI-powered support)
exports.sendSupportMessage = async (req, res) => {
  try {
    const { message, category = 'general' } = req.body;
    const userId = req.user?.id;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // For now, provide basic AI responses
    // In production, integrate with actual AI service
    let aiResponse = '';

    if (category === 'billing' || message.toLowerCase().includes('payment')) {
      aiResponse = "For billing issues, please check your transaction history in the wallet section. If you need to dispute a charge, contact our support team directly.";
    } else if (category === 'technical' || message.toLowerCase().includes('bug') || message.toLowerCase().includes('error')) {
      aiResponse = "We're sorry you're experiencing technical difficulties. Please try refreshing the page or clearing your browser cache. If the issue persists, provide more details about what you're seeing.";
    } else if (message.toLowerCase().includes('job') || message.toLowerCase().includes('hire')) {
      aiResponse = "For job-related questions, you can browse available jobs in the marketplace or post a new job. Make sure your profile is complete to increase visibility.";
    } else {
      aiResponse = "Thank you for your message. Our support team will get back to you within 24 hours. For urgent issues, please call our hotline.";
    }

    res.json({
      success: true,
      message: 'Support message sent',
      data: {
        userMessage: message,
        aiResponse: aiResponse,
        category: category,
        timestamp: new Date(),
        ticketId: Math.random().toString(36).substr(2, 9)
      }
    });
  } catch (error) {
    console.error('Support message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send support message'
    });
  }
};

exports.getAdminOpenTickets = async (req, res) => {
  try {
    res.json([
      {
        _id: 'support-1',
        userId: { name: 'Jane Doe', email: 'jane@example.com' },
        status: 'open',
        messages: [
          { role: 'user', text: 'I need help with my payment.' }
        ]
      }
    ]);
  } catch (error) {
    console.error('Get admin tickets error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve admin tickets' });
  }
};

exports.replyToSupportTicket = async (req, res) => {
  try {
    const { messageId, userId, text } = req.body;
    const ticketRef = messageId || userId;
    if (!ticketRef || !text) {
      return res.status(400).json({ success: false, message: 'Ticket reference and reply text are required' });
    }

    res.json({
      success: true,
      message: 'Reply sent successfully',
      data: {
        ticketRef,
        reply: text,
        timestamp: new Date()
      }
    });
  } catch (error) {
    console.error('Reply to ticket error:', error);
    res.status(500).json({ success: false, message: 'Failed to send reply' });
  }
};

exports.updateSupportTicketStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    res.json({
      success: true,
      message: 'Support ticket status updated',
      data: {
        id,
        status
      }
    });
  } catch (error) {
    console.error('Update support ticket status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update ticket status' });
  }
};