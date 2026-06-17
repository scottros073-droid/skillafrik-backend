// backend/controllers/categoriesController.js

// Get all categories
exports.getCategories = async (req, res) => {
  try {
    const categories = [
      { id: 1, name: 'Web Development', slug: 'web-dev', icon: '💻' },
      { id: 2, name: 'Mobile Development', slug: 'mobile-dev', icon: '📱' },
      { id: 3, name: 'Design', slug: 'design', icon: '🎨' },
      { id: 4, name: 'Writing', slug: 'writing', icon: '✍️' },
      { id: 5, name: 'Data Science', slug: 'data-science', icon: '📊' },
      { id: 6, name: 'Business', slug: 'business', icon: '💼' },
      { id: 7, name: 'Marketing', slug: 'marketing', icon: '📢' },
      { id: 8, name: 'Consulting', slug: 'consulting', icon: '🤝' }
    ];

    res.json({
      success: true,
      statusCode: 200,
      message: 'Categories retrieved',
      data: categories
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};