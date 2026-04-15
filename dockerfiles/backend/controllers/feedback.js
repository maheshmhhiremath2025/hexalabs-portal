const LabFeedback = require('../models/labFeedback');
const { logger } = require('../plugins/logger');

/**
 * POST /selfservice/feedback
 * Public — submit lab feedback. One submission per email+trainingName.
 */
async function handleSubmitFeedback(req, res) {
  try {
    const { email, trainingName, organization, rating, difficulty, contentQuality, labEnvironment, wouldRecommend, comments } = req.body;

    // Validate required fields
    if (!email || !trainingName || !rating) {
      return res.status(400).json({ message: 'email, trainingName, and rating are required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email address' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    // Check for duplicate
    const existing = await LabFeedback.findOne({ email: email.toLowerCase(), trainingName });
    if (existing) {
      return res.status(409).json({ message: 'You have already submitted feedback for this training' });
    }

    const feedback = new LabFeedback({
      email: email.toLowerCase(),
      trainingName,
      organization,
      rating,
      difficulty,
      contentQuality,
      labEnvironment,
      wouldRecommend,
      comments: comments ? comments.slice(0, 1000) : undefined,
    });

    await feedback.save();
    res.status(201).json({ message: 'Feedback submitted successfully' });
  } catch (err) {
    logger.error(`[feedback] submit error: ${err.message}`);
    res.status(500).json({ message: 'Failed to submit feedback' });
  }
}

/**
 * GET /selfservice/feedback/check?email=...&trainingName=...
 * Public — check if feedback already submitted.
 */
async function handleCheckFeedback(req, res) {
  try {
    const { email, trainingName } = req.query;
    if (!email || !trainingName) {
      return res.status(400).json({ message: 'email and trainingName required' });
    }
    const existing = await LabFeedback.findOne({ email: email.toLowerCase(), trainingName });
    res.json({ submitted: !!existing });
  } catch (err) {
    res.status(500).json({ message: 'Failed to check feedback status' });
  }
}

/**
 * GET /selfservice/feedback/:trainingName
 * Public — average ratings for a training.
 */
async function handleGetTrainingRatings(req, res) {
  try {
    const { trainingName } = req.params;
    const result = await LabFeedback.aggregate([
      { $match: { trainingName } },
      {
        $group: {
          _id: '$trainingName',
          avgRating: { $avg: '$rating' },
          avgContentQuality: { $avg: '$contentQuality' },
          avgLabEnvironment: { $avg: '$labEnvironment' },
          totalResponses: { $sum: 1 },
          recommendCount: { $sum: { $cond: ['$wouldRecommend', 1, 0] } },
          difficultyBreakdown: { $push: '$difficulty' },
        },
      },
    ]);

    if (!result.length) {
      return res.json({ trainingName, avgRating: 0, totalResponses: 0 });
    }

    const data = result[0];
    // Count difficulty values
    const difficultyCounts = { too_easy: 0, just_right: 0, too_hard: 0 };
    data.difficultyBreakdown.forEach(d => { if (d && difficultyCounts[d] !== undefined) difficultyCounts[d]++; });

    res.json({
      trainingName,
      avgRating: Math.round(data.avgRating * 10) / 10,
      avgContentQuality: data.avgContentQuality ? Math.round(data.avgContentQuality * 10) / 10 : null,
      avgLabEnvironment: data.avgLabEnvironment ? Math.round(data.avgLabEnvironment * 10) / 10 : null,
      totalResponses: data.totalResponses,
      recommendPercent: data.totalResponses > 0 ? Math.round((data.recommendCount / data.totalResponses) * 100) : 0,
      difficultyCounts,
    });
  } catch (err) {
    logger.error(`[feedback] ratings error: ${err.message}`);
    res.status(500).json({ message: 'Failed to get ratings' });
  }
}

/**
 * GET /admin/feedback
 * Admin — list all feedback with filters.
 */
async function handleAdminListFeedback(req, res) {
  try {
    const { trainingName, organization, minRating, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (trainingName) filter.trainingName = trainingName;
    if (organization) filter.organization = organization;
    if (minRating) filter.rating = { $gte: Number(minRating) };

    const skip = (Number(page) - 1) * Number(limit);
    const [feedback, total] = await Promise.all([
      LabFeedback.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      LabFeedback.countDocuments(filter),
    ]);

    res.json({ feedback, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    logger.error(`[feedback] admin list error: ${err.message}`);
    res.status(500).json({ message: 'Failed to list feedback' });
  }
}

/**
 * GET /admin/feedback/summary
 * Admin — aggregate ratings by training.
 */
async function handleAdminFeedbackSummary(req, res) {
  try {
    const summary = await LabFeedback.aggregate([
      {
        $group: {
          _id: '$trainingName',
          avgRating: { $avg: '$rating' },
          avgContentQuality: { $avg: '$contentQuality' },
          avgLabEnvironment: { $avg: '$labEnvironment' },
          totalResponses: { $sum: 1 },
          recommendCount: { $sum: { $cond: ['$wouldRecommend', 1, 0] } },
        },
      },
      { $sort: { totalResponses: -1 } },
      {
        $project: {
          trainingName: '$_id',
          avgRating: { $round: ['$avgRating', 1] },
          avgContentQuality: { $round: ['$avgContentQuality', 1] },
          avgLabEnvironment: { $round: ['$avgLabEnvironment', 1] },
          totalResponses: 1,
          recommendPercent: {
            $round: [{ $multiply: [{ $divide: ['$recommendCount', '$totalResponses'] }, 100] }, 0],
          },
          _id: 0,
        },
      },
    ]);

    res.json(summary);
  } catch (err) {
    logger.error(`[feedback] admin summary error: ${err.message}`);
    res.status(500).json({ message: 'Failed to get feedback summary' });
  }
}

module.exports = {
  handleSubmitFeedback,
  handleCheckFeedback,
  handleGetTrainingRatings,
  handleAdminListFeedback,
  handleAdminFeedbackSummary,
};
