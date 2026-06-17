// backend/controllers/portfolioController.js
const Portfolio = require("../models/Portfolio");

/**
 * Create a portfolio
 */
exports.createPortfolio = async (req, res) => {
  try {
    const { title, description, projects, isPublic } = req.body;
    const userId = req.user.id;

    const portfolio = await Portfolio.create({
      userId,
      title,
      description,
      projects: projects || [],
      isPublic: isPublic !== undefined ? isPublic : true
    });

    res.status(201).json({
      success: true,
      data: {
        id: portfolio._id,
        title: portfolio.title,
        description: portfolio.description,
        projects: portfolio.projects,
        isPublic: portfolio.isPublic,
        createdAt: portfolio.createdAt
      }
    });
  } catch (error) {
    console.error("Error creating portfolio:", error);
    res.status(500).json({ success: false, message: "Failed to create portfolio" });
  }
};

/**
 * Get user's portfolios
 */
exports.getMyPortfolios = async (req, res) => {
  try {
    const userId = req.user.id;

    const portfolios = await Portfolio.find({ userId }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: portfolios.map(p => ({
        id: p._id,
        title: p.title,
        description: p.description,
        projects: p.projects,
        isPublic: p.isPublic,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }))
    });
  } catch (error) {
    console.error("Error getting portfolios:", error);
    res.status(500).json({ success: false, message: "Failed to get portfolios" });
  }
};

/**
 * Get portfolio by ID
 */
exports.getPortfolio = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const portfolio = await Portfolio.findById(id);

    if (!portfolio) {
      return res.status(404).json({ success: false, message: "Portfolio not found" });
    }

    // Only allow access if portfolio is public or user owns it
    if (!portfolio.isPublic && portfolio.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    res.json({
      id: portfolio._id,
      title: portfolio.title,
      description: portfolio.description,
      projects: portfolio.projects,
      isPublic: portfolio.isPublic,
      createdAt: portfolio.createdAt,
      updatedAt: portfolio.updatedAt
    });
  } catch (error) {
    console.error("Error getting portfolio:", error);
    res.status(500).json({ success: false, message: "Failed to get portfolio" });
  }
};

/**
 * Update portfolio
 */
exports.updatePortfolio = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    const portfolio = await Portfolio.findById(id);

    if (!portfolio) {
      return res.status(404).json({ success: false, message: "Portfolio not found" });
    }

    if (portfolio.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    res.json({
      success: true,
      data: {
        id: portfolio._id,
        title: portfolio.title,
        description: portfolio.description,
        projects: portfolio.projects,
        isPublic: portfolio.isPublic,
        createdAt: portfolio.createdAt,
        updatedAt: portfolio.updatedAt
      }
    });
  } catch (error) {
    console.error("Error updating portfolio:", error);
    res.status(500).json({ success: false, message: "Failed to update portfolio" });
  }
};

/**
 * Delete portfolio
 */
exports.deletePortfolio = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const portfolio = await Portfolio.findById(id);

    if (!portfolio) {
      return res.status(404).json({ success: false, message: "Portfolio not found" });
    }

    if (portfolio.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await portfolio.remove();

    res.json({
      success: true,
      data: { message: "Portfolio deleted successfully" }
    });
  } catch (error) {
    console.error("Error deleting portfolio:", error);
    res.status(500).json({ success: false, message: "Failed to delete portfolio" });
  }
};

/**
 * Add project to portfolio
 */
exports.addProject = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { title, description, images, link, technologies } = req.body;

    const portfolio = await Portfolio.findById(id);

    if (!portfolio) {
      return res.status(404).json({ success: false, message: "Portfolio not found" });
    }

    if (portfolio.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const newProject = {
      title,
      description,
      images: images || [],
      link,
      technologies: technologies || []
    };

    portfolio.projects.push(newProject);
    await portfolio.save();

    res.status(201).json({
      success: true,
      data: {
        id: portfolio.projects[portfolio.projects.length - 1]._id,
        title: newProject.title,
        description: newProject.description,
        images: newProject.images,
        link: newProject.link,
        technologies: newProject.technologies
      }
    });
  } catch (error) {
    console.error("Error adding project:", error);
    res.status(500).json({ success: false, message: "Failed to add project" });
  }
};

/**
 * Remove project from portfolio
 */
exports.removeProject = async (req, res) => {
  try {
    const { id, projectId } = req.params;
    const userId = req.user.id;

    const portfolio = await Portfolio.findById(id);

    if (!portfolio) {
      return res.status(404).json({ success: false, message: "Portfolio not found" });
    }

    if (portfolio.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    portfolio.projects = portfolio.projects.filter(p => p._id.toString() !== projectId);
    await portfolio.save();

    res.json({
      success: true,
      data: { message: "Project removed successfully" }
    });
  } catch (error) {
    console.error("Error removing project:", error);
    res.status(500).json({ success: false, message: "Failed to remove project" });
  }
};