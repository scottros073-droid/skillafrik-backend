// backend/controllers/communityController.js
const mongoose = require('mongoose');

const replySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, trim: true, maxlength: 1000 },
  upvotes: { type: Number, default: 0 },
  downvotes: { type: Number, default: 0 },
  voters: { type: Map, of: String, default: {} }
}, { timestamps: true });

const communityPostSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  content: { type: String, required: true, trim: true, maxlength: 1000 },
  tags: [{ type: String, trim: true, maxlength: 40 }],
  imageUrl: String,
  upvotes: { type: Number, default: 0 },
  downvotes: { type: Number, default: 0 },
  voters: { type: Map, of: String, default: {} },
  replies: [replySchema]
}, { timestamps: true });

const CommunityPost = mongoose.models.CommunityPost || mongoose.model('CommunityPost', communityPostSchema);

const normalizeVote = (value) => (
  ['up', 'like', 'upvote'].includes(String(value).toLowerCase()) ? 'up' : 'down'
);

const applyVote = (target, userId, voteType) => {
  const previous = target.voters?.get?.(userId);
  if (previous === voteType) return;
  if (previous === 'up') target.upvotes = Math.max(0, (target.upvotes || 0) - 1);
  if (previous === 'down') target.downvotes = Math.max(0, (target.downvotes || 0) - 1);
  if (voteType === 'up') target.upvotes = (target.upvotes || 0) + 1;
  if (voteType === 'down') target.downvotes = (target.downvotes || 0) + 1;
  target.voters.set(userId, voteType);
};

exports.getCommunity = async (req, res) => {
  try {
    const posts = await CommunityPost.find()
      .populate('user', 'firstName lastName avatar badges')
      .populate('replies.user', 'firstName lastName avatar')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      statusCode: 200,
      message: 'Community content retrieved',
      data: posts,
      posts
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.createPost = async (req, res) => {
  try {
    const { title, content, tags = [], imageUrl } = req.body || {};
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ success: false, message: 'Title and content are required' });
    }

    const post = await CommunityPost.create({
      user: req.user._id,
      title: title.trim(),
      content: content.trim(),
      tags: Array.isArray(tags) ? tags.slice(0, 8) : [],
      imageUrl
    });

    await post.populate('user', 'firstName lastName avatar badges');
    res.status(201).json({ success: true, statusCode: 201, message: 'Post created', data: post, post });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create post' });
  }
};

exports.voteCommunity = async (req, res) => {
  try {
    const { contentId, postId, voteType, replyId } = req.body || {};
    const targetPostId = postId || contentId;
    const userId = String(req.user?._id || req.user?.id);
    const post = await CommunityPost.findById(targetPostId);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    if (replyId) {
      const reply = post.replies.id(replyId);
      if (!reply) return res.status(404).json({ success: false, message: 'Reply not found' });
      applyVote(reply, userId, normalizeVote(voteType));
    } else {
      applyVote(post, userId, normalizeVote(voteType));
    }

    await post.save();
    res.json({ success: true, statusCode: 200, message: 'Vote recorded', data: post });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.replyToPost = async (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content?.trim()) return res.status(400).json({ success: false, message: 'Reply content is required' });

    const post = await CommunityPost.findById(req.params.postId);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    post.replies.push({ user: req.user._id, content: content.trim() });
    await post.save();
    await post.populate('user', 'firstName lastName avatar badges');
    await post.populate('replies.user', 'firstName lastName avatar');

    res.status(201).json({ success: true, statusCode: 201, message: 'Reply added', data: post });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to add reply' });
  }
};
