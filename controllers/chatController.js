// backend/controllers/chatController.js
const Chat = require("../models/Chat");
const User = require("../models/User");
const Job = require("../models/Job");
const mongoose = require("mongoose");

/**
 * Create a new chat
 */
exports.createChat = async (req, res) => {
  try {
    const { participants = [], jobId } = req.body;
    const creatorId = req.user.id;
    const participantIds = Array.isArray(participants)
      ? participants.filter(Boolean).map((participant) => participant.toString())
      : [];

    // Ensure creator is included in participants
    if (!participantIds.includes(creatorId.toString())) {
      participantIds.push(creatorId);
    }

    if (participantIds.length < 2) {
      return res.status(400).json({ success: false, message: "At least two participants are required" });
    }

    if (!jobId) {
      return res.status(403).json({
        success: false,
        message: "Chat opens after a client messages an applicant or a freelancer is hired"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(404).json({ success: false, message: "Job not found for this conversation" });
    }

    const job = await Job.findById(jobId).select("clientId freelancerId applications status");
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found for this conversation" });
    }

    const otherParticipantId = participantIds.find((participantId) => participantId !== creatorId.toString());
    const creatorIsClient = job.clientId?.toString() === creatorId.toString();
    const otherIsApplicant = (job.applications || []).some((application) => {
      const applicantId = application.freelancerId?._id?.toString()
        || application.freelancerId?.toString()
        || String(application.freelancerId || "");
      return applicantId === otherParticipantId;
    });
    const hiredFreelancerId = job.freelancerId?.toString();
    const hiredChat = Boolean(hiredFreelancerId)
      && participantIds.includes(job.clientId.toString())
      && participantIds.includes(hiredFreelancerId);
    const clientMessagingApplicant = creatorIsClient && otherIsApplicant;

    if (!clientMessagingApplicant && !hiredChat) {
      return res.status(403).json({
        success: false,
        message: "Chat opens after you message an applicant or hire a freelancer for this job"
      });
    }

    // Check if chat already exists between these participants for this job
    const existingChat = await Chat.findOne({
      participants: { $all: participantIds, $size: participantIds.length },
      jobId: jobId || null
    });

    if (existingChat) {
      return res.json({
        id: existingChat._id,
        participants: existingChat.participants,
        jobId: existingChat.jobId,
        createdAt: existingChat.createdAt
      });
    }

    const chat = await Chat.create({
      participants: participantIds,
      jobId,
      createdBy: creatorId
    });

    res.status(201).json({
      id: chat._id,
      participants: chat.participants,
      jobId: chat.jobId,
      createdAt: chat.createdAt
    });
  } catch (error) {
    console.error("Error creating chat:", error);
    res.status(500).json({
      success: false,
      message: 'Unable to create chat at this time',
      data: []
    });
  }
};

/**
 * Get chat by ID
 */
exports.getChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    const chat = await Chat.findById(chatId)
      .populate('participants', 'firstName lastName avatar')
      .populate('jobId', 'title budget status escrowId escrowStatus escrowAmount');

    if (!chat || !chat.participants.some(p => p._id.toString() === userId)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    res.json({
      id: chat._id,
      participants: chat.participants.map(p => ({
        id: p._id,
        name: `${p.firstName} ${p.lastName}`,
        avatar: p.avatar
      })),
      jobId: chat.jobId ? {
        id: chat.jobId._id,
        title: chat.jobId.title,
        budget: chat.jobId.budget,
        status: chat.jobId.status,
        escrowId: chat.jobId.escrowId,
        escrowStatus: chat.jobId.escrowStatus,
        escrowAmount: chat.jobId.escrowAmount
      } : null,
      lastMessage: chat.lastMessage,
      lastMessageAt: chat.lastMessageAt,
      createdAt: chat.createdAt
    });
  } catch (error) {
    console.error("Error getting chat:", error);
    res.status(500).json({
      success: false,
      message: 'Unable to load chat',
      data: []
    });
  }
};

/**
 * Get user's chats
 */
exports.getChats = async (req, res) => {
  try {
    const userId = req.user.id;

    const chats = await Chat.find({ participants: userId })
      .populate('participants', 'firstName lastName avatar')
      .populate('jobId', 'title budget status escrowId escrowStatus escrowAmount')
      .populate('lastMessageBy', 'firstName lastName')
      .sort({ lastMessageAt: -1 });

    res.json({
      chats: chats.map(chat => ({
        id: chat._id,
        participants: chat.participants.map(p => ({
          id: p._id,
          name: `${p.firstName} ${p.lastName}`,
          avatar: p.avatar
        })),
        jobId: chat.jobId ? {
          id: chat.jobId._id,
          title: chat.jobId.title,
          budget: chat.jobId.budget,
          status: chat.jobId.status,
          escrowId: chat.jobId.escrowId,
          escrowStatus: chat.jobId.escrowStatus,
          escrowAmount: chat.jobId.escrowAmount
        } : null,
        lastMessage: chat.lastMessage,
        lastMessageAt: chat.lastMessageAt,
        unreadCount: Array.isArray(chat.unreadCounts)
          ? chat.unreadCounts.find((entry) => entry.userId?.toString() === userId.toString())?.count || 0
          : 0,
        createdAt: chat.createdAt
      }))
    });
  } catch (error) {
    console.error("Error getting chats:", error);
    res.status(500).json({
      success: false,
      message: 'Unable to retrieve chat list',
      data: []
    });
  }
};
