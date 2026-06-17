const axios = require('axios');
const AICredit = require('../models/AICredit');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');

class AIService {
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.openaiBaseUrl = 'https://api.openai.com/v1';
  }

  hasOpenAI() {
    return Boolean(this.openaiApiKey && this.openaiApiKey !== 'your-openai-api-key');
  }

  async chatCompletion(prompt, { max_tokens = 600, temperature = 0.7 } = {}) {
    if (!this.hasOpenAI()) {
      return this.generateLocalText(prompt);
    }

    const response = await axios.post(`${this.openaiBaseUrl}/chat/completions`, {
      model: process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens,
      temperature
    }, {
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });

    return response.data.choices[0].message.content.trim();
  }

  generateLocalText(prompt = '') {
    const cleanPrompt = String(prompt).replace(/\s+/g, ' ').trim();
    return [
      'Here is a polished draft you can edit:',
      '',
      cleanPrompt.slice(0, 500),
      '',
      'I will focus on clear outcomes, relevant experience, realistic timelines, and a professional tone tailored to the client.'
    ].join('\n');
  }

  // Check if user has credits or subscription
  async checkCredits(userId, type) {
    try {
      let aiCredit = await AICredit.findOne({ userId });
      if (!aiCredit) {
        // Create default AI credits for new user
        aiCredit = await AICredit.create({
          userId,
          proposalCredits: 5,
          designCredits: 3,
          cvCredits: 2,
          hasUnlimitedCredits: false,
          totalUsed: 0
        });
      }

      const creditMap = {
        proposal: aiCredit.proposalCredits,
        design: aiCredit.designCredits,
        cv: aiCredit.cvCredits
      };

      return {
        hasCredits: creditMap[type] > 0 || aiCredit.hasUnlimitedCredits,
        creditsRemaining: aiCredit.hasUnlimitedCredits ? 999 : creditMap[type]
      };
    } catch (error) {
      console.error('Error checking AI credits:', error);
      return { hasCredits: false, creditsRemaining: 0 };
    }
  }

  // Deduct credits
  async deductCredits(userId, type) {
    try {
      const aiCredit = await AICredit.findOne({ userId });
      if (!aiCredit) {
        throw new Error('No AI credits found');
      }

      if (aiCredit.hasUnlimitedCredits) {
        // Unlimited credits, just track usage
        aiCredit.totalUsed += 1;
        await aiCredit.save();
        return aiCredit;
      }

      const creditField = `${type}Credits`;
      if (aiCredit[creditField] <= 0) {
        throw new Error('Insufficient credits');
      }

      aiCredit[creditField] -= 1;
      aiCredit.totalUsed += 1;
      await aiCredit.save();

      // Log transaction
      await Transaction.create({
        userId,
        type: 'debit',
        amount: 0, // AI credits are separate from wallet
        description: `AI ${type} generation`,
        metadata: { aiType: type }
      });

      return aiCredit;
    } catch (error) {
      console.error('Error deducting AI credits:', error);
      throw error;
    }
  }

  // Generate AI proposal
  async generateProposal(jobTitle, jobDescription, freelancerBio = '') {
    try {
      const prompt = `Write a professional proposal for this job:

Job Title: ${jobTitle}
Job Description: ${jobDescription}
${freelancerBio ? `Freelancer Background: ${freelancerBio}` : ''}

Write a compelling proposal that highlights relevant skills and experience.`;

      return this.chatCompletion(prompt, { max_tokens: 500 });
    } catch (error) {
      console.error('Error generating AI proposal:', error);
      throw new Error('Failed to generate proposal');
    }
  }

  // Generate AI CV
  async generateCV(userData) {
    try {
      const prompt = `Generate a professional CV/resume based on this information:

Name: ${userData.fullName}
Email: ${userData.email}
Phone: ${userData.phone}
Summary: ${userData.summary}

Experience:
${userData.experience?.map(exp => `- ${exp.position} at ${exp.company} (${exp.duration}): ${exp.description}`).join('\n') || 'None provided'}

Education:
${userData.education?.map(edu => `- ${edu.degree} from ${edu.school} (${edu.year})`).join('\n') || 'None provided'}

Skills: ${userData.skills?.join(', ') || 'None provided'}

Format this as a professional CV with proper sections and formatting.`;

      return this.chatCompletion(prompt, { max_tokens: 1000 });
    } catch (error) {
      console.error('Error generating AI CV:', error);
      throw new Error('Failed to generate CV');
    }
  }

  // Generate AI job description
  async generateJobDescription(jobData) {
    try {
      const prompt = `Create a detailed job description for this position:

Title: ${jobData.jobTitle}
Category: ${jobData.category}
Description: ${jobData.description}

Make it professional, detailed, and attractive to freelancers. Include requirements, responsibilities, and benefits.`;

      return this.chatCompletion(prompt, { max_tokens: 600 });
    } catch (error) {
      console.error('Error generating job description:', error);
      throw new Error('Failed to generate job description');
    }
  }

  // Generate AI portfolio content
  async generatePortfolioContent(title, description, skills) {
    try {
      const prompt = `Create compelling portfolio content for a project:

Title: ${title}
Description: ${description}
Skills: ${skills?.join(', ') || 'Various'}

Write an engaging project description that showcases the work and skills used.`;

      return this.chatCompletion(prompt, { max_tokens: 400 });
    } catch (error) {
      console.error('Error generating portfolio content:', error);
      throw new Error('Failed to generate portfolio content');
    }
  }

  // Analyze proposal
  async analyzeProposal(proposal, jobTitle, jobDescription) {
    try {
      const prompt = `Analyze this job proposal and provide feedback:

Job Title: ${jobTitle}
Job Description: ${jobDescription}

Proposal: ${proposal}

Provide:
1. Overall score (1-10)
2. Strengths
3. Areas for improvement
4. Suggestions to make it better

Format as JSON with keys: score, strengths, improvements, suggestions`;

      const text = await this.chatCompletion(prompt, { max_tokens: 500 });
      try {
        return JSON.parse(text);
      } catch {
        return {
          score: 7,
          analysis: text,
          strengths: ['Clear intent', 'Relevant positioning'],
          improvements: ['Add specific examples', 'Mention timeline and next steps'],
          suggestions: ['Personalize the opening and include one measurable outcome.']
        };
      }
    } catch (error) {
      console.error('Error analyzing proposal:', error);
      throw new Error('Failed to analyze proposal');
    }
  }

  // Generate logo (placeholder - would need DALL-E or similar)
  async generateLogo({ prompt, style, businessName }) {
    try {
      const label = String(businessName || prompt || 'SkillAfrik Logo').slice(0, 40);
      const accent = style === 'bold' ? '#111827' : style === 'playful' ? '#f59e0b' : '#2563eb';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" rx="96" fill="#f8fafc"/><circle cx="400" cy="320" r="150" fill="${accent}"/><path d="M275 495c65-88 185-88 250 0" fill="none" stroke="#10b981" stroke-width="42" stroke-linecap="round"/><text x="400" y="610" text-anchor="middle" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="#111827">${label.replace(/[<>&]/g, '')}</text></svg>`;
      const mockImageUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

      return {
        imageUrl: mockImageUrl,
        prompt: prompt,
        style: style,
        businessName: businessName
      };
    } catch (error) {
      console.error('Error generating logo:', error);
      throw new Error('Failed to generate logo');
    }
  }

  async assistantReply(message) {
    const prompt = `You are SkillAfrik's assistant. Give short, practical help for freelancers and clients.\n\nUser: ${message}`;
    return this.chatCompletion(prompt, { max_tokens: 350, temperature: 0.5 });
  }
}

module.exports = new AIService();
