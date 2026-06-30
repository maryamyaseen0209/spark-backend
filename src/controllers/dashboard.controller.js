import QuizAttempt from '../models/QuizAttempt.js';
import Quiz from '../models/Quiz.js';
import Assignment from '../models/Assignment.js';
import Badge from '../models/Badge.js';
import Classroom from '../models/Classroom.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getDashboard = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const role = req.user.role;

  let dashboard;

  if (role === 'student') {
    dashboard = await getStudentDashboard(userId);
  } else if (role === 'teacher') {
    dashboard = await getTeacherDashboard(userId);
  } else if (role === 'admin') {
    dashboard = await getAdminDashboard();
  } else {
    dashboard = getDefaultDashboard('student');
  }

  res.json({
    success: true,
    message: 'Dashboard data loaded successfully.',
    dashboard,
  });
});

export const exportAnalytics = asyncHandler(async (req, res) => {
  const dashboard = req.user.role === 'teacher'
    ? await getTeacherDashboard(req.user._id)
    : req.user.role === 'admin'
      ? await getAdminDashboard()
      : await getStudentDashboard(req.user._id);
  const format = String(req.query.format || 'json').toLowerCase();
  const rows = buildExportRows(req.user.role, dashboard);
  const report = {
    format,
    generatedAt: new Date().toISOString(),
    role: req.user.role,
    summary: dashboard.analytics?.reportSummary || dashboard.analytics?.growthSummary || dashboard.stats,
    rows,
    data: dashboard.analytics || dashboard,
  };

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="study-sparkai-${req.user.role}-analytics.csv"`);
    return res.send(toCsv(rows));
  }

  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="study-sparkai-${req.user.role}-analytics.pdf"`);
    return res.send(toPdf(report));
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="study-sparkai-${req.user.role}-analytics.json"`);
  res.json({ success: true, message: 'Analytics export downloaded successfully.', export: report });
});

export const getLeaderboard = asyncHandler(async (req, res) => {
  let match = { status: 'submitted' };
  if (req.user.role === 'teacher') {
    const quizIds = await Quiz.find({ teacher: req.user._id }).distinct('_id');
    match = { ...match, quiz: { $in: quizIds } };
  } else if (req.user.role === 'student') {
    const classroomIds = await Classroom.find({ students: req.user._id, status: 'active' }).distinct('_id');
    if (classroomIds.length) match = { ...match, classroom: { $in: classroomIds } };
  }

  const rows = await QuizAttempt.aggregate([
    { $match: match },
    { $group: { _id: '$student', attempts: { $sum: 1 }, averageScore: { $avg: '$score' }, bestScore: { $max: '$score' }, points: { $sum: '$score' } } },
    { $sort: { points: -1, averageScore: -1, bestScore: -1 } },
    { $limit: 25 },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'student' } },
    { $unwind: '$student' },
    { $project: { studentId: '$_id', name: '$student.fullName', attempts: 1, averageScore: { $round: ['$averageScore', 0] }, bestScore: 1, points: { $round: ['$points', 0] } } },
  ]);

  const leaderboard = rows.map((row, index) => ({ rank: index + 1, ...row }));
  res.json({ success: true, scope: req.user.role === 'teacher' ? 'teacher-classrooms' : req.user.role === 'student' ? 'student-classrooms' : 'platform', leaderboard });
});

export const getBadges = asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') {
    const catalog = await Badge.find({ isActive: true }).sort({ category: 1, points: 1, goal: 1 }).lean();
    return res.json({ success: true, badges: catalog.map((badge) => ({ ...badge, unlocked: false, progress: 0 })) });
  }

  const dashboard = await getStudentDashboard(req.user._id);
  const earned = dashboard.analytics?.badges || [];
  const configured = await ensureDefaultBadges(earned);
  const byName = new Map(earned.map((badge) => [badge.name, badge]));

  res.json({
    success: true,
    badges: configured.map((badge) => ({
      id: badge._id,
      key: badge.key,
      name: badge.name,
      description: badge.description,
      category: badge.category,
      points: badge.points,
      ...(byName.get(badge.name) || { unlocked: false, progress: 0, goal: badge.goal }),
    })),
  });
});

export const getReportOverview = asyncHandler(async (req, res) => {
  const dashboard = req.user.role === 'teacher'
    ? await getTeacherDashboard(req.user._id)
    : req.user.role === 'admin'
      ? await getAdminDashboard()
      : await getStudentDashboard(req.user._id);

  res.json({
    success: true,
    report: {
      role: req.user.role,
      generatedAt: new Date().toISOString(),
      summary: dashboard.analytics?.reportSummary || dashboard.stats || [],
      charts: {
        trend: dashboard.analytics?.classTrend || dashboard.usageTrend || dashboard.performanceTrend || [],
        bands: dashboard.analytics?.scoreBands || [],
        leaderboard: dashboard.analytics?.leaderboard || [],
      },
      recommendations: dashboard.analytics?.recommendations || dashboard.analytics?.smartInsights || [],
      exportFormats: dashboard.analytics?.exportFormats || ['json', 'csv', 'pdf'],
    },
  });
});

export const getProgressAnalytics = asyncHandler(async (req, res) => {
  const dashboard = req.user.role === 'teacher'
    ? await getTeacherDashboard(req.user._id)
    : req.user.role === 'admin'
      ? await getAdminDashboard()
      : await getStudentDashboard(req.user._id);

  res.json({
    success: true,
    analytics: dashboard.analytics || {},
    stats: dashboard.stats || [],
    classroomPerformance: dashboard.classroomPerformance || [],
    performanceDistribution: dashboard.performanceDistribution || [],
    usageTrend: dashboard.usageTrend || [],
    generatedAt: new Date().toISOString(),
  });
});

async function getStudentDashboard(userId) {
  // Quiz attempt statistics
  const attemptStats = await QuizAttempt.aggregate([
    { $match: { student: userId, status: 'submitted' } },
    {
      $group: {
        _id: null,
        totalAttempts: { $sum: 1 },
        averageScore: { $avg: '$score' },
        totalCorrect: { $sum: '$correctCount' },
        totalQuestions: { $sum: '$totalQuestions' },
      },
    },
  ]);

  // Total assignments generated
  const totalAssignments = await Assignment.countDocuments({ student: userId });

  // Learning streak calculation
  const user = await User.findById(userId).select('learningStreak');
  const streakDays = user?.learningStreak?.current || 0;

  // Recent quiz attempts with populated quiz details
  const recentAttempts = await QuizAttempt.find({ student: userId, status: 'submitted' })
    .sort({ submittedAt: -1 })
    .limit(5)
    .populate('quiz', 'title subject')
    .lean();

  // Performance trend (last 7 attempts)
  const performanceTrend = await QuizAttempt.find({ student: userId, status: 'submitted' })
    .sort({ submittedAt: -1 })
    .limit(7)
    .select('score submittedAt quiz')
    .populate('quiz', 'title')
    .lean();

  const stats = [];
  const attemptsData = attemptStats[0] || { totalAttempts: 0, averageScore: 0, totalCorrect: 0, totalQuestions: 0 };
  const avgScore = Math.round(attemptsData.averageScore || 0);

  stats.push({ label: 'Quizzes attempted', value: attemptsData.totalAttempts, icon: 'BrainCircuit', color: 'from-blue-500 to-cyan-400' });
  stats.push({ label: 'Average score', value: `${avgScore}%`, icon: 'Target', color: avgScore >= 60 ? 'from-emerald-400 to-green-500' : 'from-amber-400 to-orange-500' });
  stats.push({ label: 'Assignments generated', value: totalAssignments, icon: 'FileText', color: 'from-violet-500 to-fuchsia-400' });
  stats.push({ label: 'Learning streak', value: `${streakDays} day${streakDays !== 1 ? 's' : ''}`, icon: 'Zap', color: streakDays > 0 ? 'from-amber-400 to-orange-500' : 'from-slate-400 to-slate-500' });

  const formattedAttempts = recentAttempts.map((a) => ({
    id: a._id,
    quizTitle: a.quiz?.title || 'Unknown Quiz',
    subject: a.quiz?.subject || '',
    score: a.score,
    passed: a.passed,
    submittedAt: a.submittedAt,
  }));

  const trend = performanceTrend.map((a) => ({
    label: a.quiz?.title?.slice(0, 15) || 'Quiz',
    score: a.score,
    date: a.submittedAt,
  })).reverse();

  const dailyActivityRaw = await QuizAttempt.aggregate([
    { $match: { student: userId, status: 'submitted', submittedAt: { $exists: true } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$submittedAt' } }, attempts: { $sum: 1 }, averageScore: { $avg: '$score' } } },
    { $sort: { _id: 1 } },
    { $limit: 14 },
  ]);
  const activityHeatmap = dailyActivityRaw.map((day) => ({ date: day._id, attempts: day.attempts, averageScore: Math.round(day.averageScore || 0) }));

  const subjectPerformance = await QuizAttempt.aggregate([
    { $match: { student: userId, status: 'submitted' } },
    { $lookup: { from: 'quizzes', localField: 'quiz', foreignField: '_id', as: 'quizInfo' } },
    { $unwind: '$quizInfo' },
    { $group: { _id: '$quizInfo.subject', attempts: { $sum: 1 }, averageScore: { $avg: '$score' } } },
    { $sort: { averageScore: -1 } },
  ]);

  const leaderboardRows = await QuizAttempt.aggregate([
    { $match: { status: 'submitted' } },
    { $group: { _id: '$student', attempts: { $sum: 1 }, averageScore: { $avg: '$score' }, bestScore: { $max: '$score' }, points: { $sum: '$score' } } },
    { $sort: { averageScore: -1, bestScore: -1 } },
    { $limit: 10 },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'studentInfo' } },
    { $unwind: '$studentInfo' },
    { $project: { studentId: '$_id', name: '$studentInfo.fullName', attempts: 1, averageScore: { $round: ['$averageScore', 0] }, bestScore: 1, points: { $round: ['$points', 0] } } },
  ]);

  const badges = buildStudentBadges({ attempts: attemptsData.totalAttempts, averageScore: avgScore, assignments: totalAssignments, streak: streakDays });
  const recommendations = buildStudentRecommendations({ averageScore: avgScore, attempts: attemptsData.totalAttempts, assignments: totalAssignments, subjects: subjectPerformance });
  const learningVelocity = buildLearningVelocity(performanceTrend);
  const reportSummary = [
    { label: 'Attempt volume', value: attemptsData.totalAttempts, status: attemptsData.totalAttempts >= 5 ? 'Strong' : 'Building' },
    { label: 'Accuracy', value: `${avgScore}%`, status: avgScore >= 80 ? 'Excellent' : avgScore >= 60 ? 'On track' : 'Needs support' },
    { label: 'Badges unlocked', value: badges.filter((badge) => badge.unlocked).length, status: 'Gamification' },
  ];

  return {
    stats,
    recentAttempts: formattedAttempts,
    performanceTrend: trend,
    analytics: {
      subjectPerformance: subjectPerformance.map((item) => ({ subject: item._id || 'General', attempts: item.attempts, averageScore: Math.round(item.averageScore || 0) })),
      leaderboard: leaderboardRows.map((row, index) => ({ rank: index + 1, ...row })),
      badges,
      recommendations,
      activityHeatmap,
      learningVelocity,
      reportSummary,
      exportFormats: ['json', 'csv', 'pdf'],
    },
    actions: ['Generate Assignment', 'Join Classroom', 'Take Quiz', 'Open AI Chat'],
    modules: ['Personalized dashboard', 'Classroom joining', 'Quiz taking', 'Progress analytics', 'Gamification'],
  };
}

async function getTeacherDashboard(userId) {
  // Find all classrooms for this teacher
  const classrooms = await Classroom.find({ teacher: userId, status: 'active' }).select('_id name students');
  const classroomIds = classrooms.map((c) => c._id);

  // Total students across classrooms
  const studentSet = new Set();
  classrooms.forEach((c) => {
    (c.students || []).forEach((s) => studentSet.add(String(s)));
  });
  const totalStudents = studentSet.size;

  // Active (published) quizzes count
  const activeQuizzes = await Quiz.countDocuments({ teacher: userId, status: 'published' });

  // Total quiz attempts across all teacher's quizzes
  const teacherQuizIds = await Quiz.find({ teacher: userId }).distinct('_id');
  const attemptStats = await QuizAttempt.aggregate([
    { $match: { quiz: { $in: teacherQuizIds }, status: 'submitted' } },
    {
      $group: {
        _id: null,
        totalAttempts: { $sum: 1 },
        averageScore: { $avg: '$score' },
      },
    },
  ]);

  // Classroom performance summaries
  const classroomPerformance = [];
  for (const c of classrooms) {
    const classQuizIds = await Quiz.find({ classroom: c._id }).distinct('_id');
    const classStats = await QuizAttempt.aggregate([
      { $match: { quiz: { $in: classQuizIds }, status: 'submitted' } },
      {
        $group: {
          _id: null,
          attempts: { $sum: 1 },
          avgScore: { $avg: '$score' },
        },
      },
    ]);
    classroomPerformance.push({
      classroomId: c._id,
      name: c.name,
      studentCount: c.students?.length || 0,
      totalAttempts: classStats[0]?.attempts || 0,
      averageScore: Math.round(classStats[0]?.avgScore || 0),
    });
  }

  // Student performance distribution
  const allAttempts = await QuizAttempt.find({ quiz: { $in: teacherQuizIds }, status: 'submitted' })
    .populate('student', 'fullName email')
    .sort({ submittedAt: -1 })
    .limit(50)
    .lean();

  const studentPerformance = {};
  allAttempts.forEach((a) => {
    const sid = String(a.student?._id || a.student);
    if (!studentPerformance[sid]) {
      studentPerformance[sid] = {
        studentId: sid,
        name: a.student?.fullName || 'Unknown',
        email: a.student?.email || '',
        attempts: 0,
        totalScore: 0,
      };
    }
    studentPerformance[sid].attempts += 1;
    studentPerformance[sid].totalScore += a.score || 0;
  });

  const performanceDistribution = Object.values(studentPerformance).map((sp) => ({
    ...sp,
    averageScore: sp.attempts > 0 ? Math.round(sp.totalScore / sp.attempts) : 0,
  }));

  const attemptData = attemptStats[0] || { totalAttempts: 0, averageScore: 0 };

  const scoreBandsRaw = await QuizAttempt.aggregate([
    { $match: { quiz: { $in: teacherQuizIds }, status: 'submitted' } },
    { $bucket: { groupBy: '$score', boundaries: [0, 50, 70, 85, 101], default: 'other', output: { count: { $sum: 1 } } } },
  ]);
  const bandLabels = { 0: 'Needs help', 50: 'Developing', 70: 'Proficient', 85: 'Advanced' };
  const scoreBands = scoreBandsRaw.map((band) => ({ label: bandLabels[band._id] || 'Other', count: band.count }));

  const quizInsights = await QuizAttempt.aggregate([
    { $match: { quiz: { $in: teacherQuizIds }, status: 'submitted' } },
    { $group: { _id: '$quiz', attempts: { $sum: 1 }, averageScore: { $avg: '$score' }, passRate: { $avg: { $cond: ['$passed', 1, 0] } } } },
    { $sort: { averageScore: 1 } },
    { $limit: 6 },
    { $lookup: { from: 'quizzes', localField: '_id', foreignField: '_id', as: 'quizInfo' } },
    { $unwind: '$quizInfo' },
    { $project: { title: '$quizInfo.title', subject: '$quizInfo.subject', attempts: 1, averageScore: { $round: ['$averageScore', 0] }, passRate: { $round: [{ $multiply: ['$passRate', 100] }, 0] } } },
  ]);

  const atRiskStudents = performanceDistribution
    .filter((student) => student.averageScore < 60 || student.attempts < 2)
    .sort((a, b) => a.averageScore - b.averageScore)
    .slice(0, 8)
    .map((student) => ({
      studentId: student.studentId,
      name: student.name,
      email: student.email,
      averageScore: student.averageScore,
      attempts: student.attempts,
      risk: student.averageScore < 50 ? 'high' : 'medium',
    }));

  const classTrendRaw = await QuizAttempt.aggregate([
    { $match: { quiz: { $in: teacherQuizIds }, status: 'submitted', submittedAt: { $exists: true } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$submittedAt' } }, attempts: { $sum: 1 }, averageScore: { $avg: '$score' } } },
    { $sort: { _id: 1 } },
    { $limit: 14 },
  ]);
  const classTrend = classTrendRaw.map((day) => ({ date: day._id, attempts: day.attempts, averageScore: Math.round(day.averageScore || 0) }));
  const engagementSummary = [
    { label: 'Students monitored', value: performanceDistribution.length },
    { label: 'At-risk students', value: atRiskStudents.length },
    { label: 'Classrooms tracked', value: classroomPerformance.length },
    { label: 'Published quizzes', value: activeQuizzes },
  ];

  const smartInsights = buildTeacherInsights({ classroomPerformance, scoreBands, quizInsights, averageScore: Math.round(attemptData.averageScore || 0) });

  const stats = [];
  stats.push({ label: 'Total students', value: totalStudents, icon: 'Users', color: 'from-blue-500 to-indigo-400' });
  stats.push({ label: 'Active quizzes', value: activeQuizzes, icon: 'BookOpen', color: 'from-violet-500 to-fuchsia-400' });
  stats.push({ label: 'Total quiz attempts', value: attemptData.totalAttempts, icon: 'Activity', color: 'from-cyan-400 to-teal-500' });
  stats.push({ label: 'Average score', value: `${Math.round(attemptData.averageScore || 0)}%`, icon: 'Target', color: 'from-emerald-400 to-green-500' });

  return {
    stats,
    classroomPerformance,
    performanceDistribution,
    analytics: {
      scoreBands,
      quizInsights,
      smartInsights,
      atRiskStudents,
      classTrend,
      engagementSummary,
      reportSummary: engagementSummary,
      exportFormats: ['json', 'csv', 'pdf'],
    },
    actions: ['Create Classroom', 'Generate Quiz from PDF', 'Monitor Students', 'Send Announcement'],
    modules: ['Classroom management', 'AI quiz generator', 'Student monitoring', 'Messaging', 'Resources'],
  };
}

async function getAdminDashboard() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Count users by role
  const totalUsers = await User.countDocuments({ status: 'active' });
  const studentsCount = await User.countDocuments({ role: 'student', status: 'active' });
  const teachersCount = await User.countDocuments({ role: 'teacher', status: 'active' });
  const adminsCount = await User.countDocuments({ role: 'admin', status: 'active' });

  // Active users in last 7 days (users with sessions)
  const activeUsers = await User.countDocuments({
    status: 'active',
    'learningStreak.lastActivityAt': { $gte: sevenDaysAgo },
  });

  // Total quizzes
  const totalQuizzes = await Quiz.countDocuments();

  // Total quiz attempts
  const totalAttempts = await QuizAttempt.countDocuments({ status: 'submitted' });

  // Total assignments
  const totalAssignments = await Assignment.countDocuments();

  // Platform usage trends (last 7 days - daily new attempts)
  const usageTrend = await QuizAttempt.aggregate([
    { $match: { submittedAt: { $gte: sevenDaysAgo }, status: 'submitted' } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$submittedAt' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const quizCreationTrend = await Quiz.aggregate([
    { $match: { createdAt: { $gte: sevenDaysAgo } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const trendData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const found = usageTrend.find((u) => u._id === key);
    trendData.push({
      date: key,
      attempts: found?.count || 0,
      quizzes: quizCreationTrend.find((u) => u._id === key)?.count || 0,
    });
  }

  const roleGrowth = await User.aggregate([
    { $match: { createdAt: { $gte: sevenDaysAgo } } },
    { $group: { _id: { role: '$role', date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } }, count: { $sum: 1 } } },
    { $sort: { '_id.date': 1 } },
  ]);
  const averageScoreRaw = await QuizAttempt.aggregate([
    { $match: { status: 'submitted' } },
    { $group: { _id: null, averageScore: { $avg: '$score' }, passRate: { $avg: { $cond: ['$passed', 1, 0] } } } },
  ]);
  const platformAverage = averageScoreRaw[0] || { averageScore: 0, passRate: 0 };

  const stats = [];
  stats.push({ label: 'Total users', value: totalUsers, icon: 'Users', color: 'from-blue-500 to-indigo-400' });
  stats.push({ label: 'Active (7 days)', value: activeUsers, icon: 'Activity', color: 'from-emerald-400 to-green-500' });
  stats.push({ label: 'Quizzes created', value: totalQuizzes, icon: 'BookOpen', color: 'from-violet-500 to-fuchsia-400' });
  stats.push({ label: 'Total attempts', value: totalAttempts, icon: 'BrainCircuit', color: 'from-cyan-400 to-teal-500' });

  return {
    stats,
    userBreakdown: { students: studentsCount, teachers: teachersCount, admins: adminsCount, total: totalUsers },
    usageTrend: trendData,
    analytics: {
      growthSummary: [
        { label: 'Students', value: studentsCount },
        { label: 'Teachers', value: teachersCount },
        { label: 'Admins', value: adminsCount },
        { label: 'Assignments', value: totalAssignments },
      ],
      platformHealth: [
        { label: 'Quiz attempts', value: totalAttempts },
        { label: 'Quiz library', value: totalQuizzes },
        { label: 'Active users', value: activeUsers },
        { label: 'Avg score', value: `${Math.round(platformAverage.averageScore || 0)}%` },
        { label: 'Pass rate', value: `${Math.round((platformAverage.passRate || 0) * 100)}%` },
      ],
      usageTrend: trendData,
      roleGrowth: roleGrowth.map((item) => ({ role: item._id.role || 'unknown', date: item._id.date, count: item.count })),
      reportSummary: [
        { label: 'Total users', value: totalUsers, status: 'Accounts' },
        { label: 'Active users', value: activeUsers, status: '7 day activity' },
        { label: 'Platform pass rate', value: `${Math.round((platformAverage.passRate || 0) * 100)}%`, status: 'Learning health' },
      ],
      exportFormats: ['json', 'csv', 'pdf'],
    },
    totalAssignments,
    lastUpdated: new Date().toISOString(),
    actions: ['Manage Users', 'Review Audit Logs', 'Moderate Content', 'Configure System'],
    modules: ['User management', 'Permission matrix', 'Content moderation', 'Platform analytics', 'System configuration'],
  };
}

function buildStudentBadges({ attempts, averageScore, assignments, streak }) {
  return [
    { name: 'Quiz Starter', description: 'Submit your first quiz attempt.', unlocked: attempts >= 1, progress: Math.min(attempts, 1), goal: 1 },
    { name: 'Consistent Learner', description: 'Build a 3 day learning streak.', unlocked: streak >= 3, progress: Math.min(streak, 3), goal: 3 },
    { name: 'Assignment Builder', description: 'Generate 5 AI assignments.', unlocked: assignments >= 5, progress: Math.min(assignments, 5), goal: 5 },
    { name: 'High Scorer', description: 'Reach an average score of 85%.', unlocked: averageScore >= 85, progress: Math.min(averageScore, 85), goal: 85 },
    { name: 'Quiz Marathon', description: 'Complete 10 quiz attempts.', unlocked: attempts >= 10, progress: Math.min(attempts, 10), goal: 10 },
  ];
}

async function ensureDefaultBadges(defaults) {
  const seed = defaults.map((badge) => ({
    key: badge.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name: badge.name,
    description: badge.description,
    goal: badge.goal,
    metric: badge.name.includes('Streak') ? 'streak' : badge.name.includes('Assignment') ? 'assignments' : badge.name.includes('High') ? 'averageScore' : 'attempts',
    category: badge.name.includes('Streak') ? 'streak' : badge.name.includes('Assignment') ? 'assignment' : badge.name.includes('High') ? 'performance' : 'quiz',
  }));
  await Promise.all(seed.map((badge) => Badge.updateOne({ key: badge.key }, { $setOnInsert: badge }, { upsert: true })));
  return Badge.find({ key: { $in: seed.map((badge) => badge.key) }, isActive: true }).sort({ points: 1, goal: 1 }).lean();
}

function buildLearningVelocity(attempts) {
  const ordered = [...attempts].reverse();
  if (ordered.length < 2) return { label: 'Not enough attempts', delta: 0, direction: 'flat' };
  const first = ordered[0]?.score || 0;
  const latest = ordered[ordered.length - 1]?.score || 0;
  const delta = latest - first;
  return { label: delta > 0 ? 'Improving' : delta < 0 ? 'Needs review' : 'Stable', delta, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' };
}

function buildExportRows(role, dashboard) {
  if (role === 'student') {
    return [
      ...(dashboard.analytics?.subjectPerformance || []).map((item) => ({ type: 'subject', name: item.subject, attempts: item.attempts, score: item.averageScore })),
      ...(dashboard.analytics?.leaderboard || []).map((item) => ({ type: 'leaderboard', name: item.name, rank: item.rank, score: item.averageScore, points: item.points })),
    ];
  }
  if (role === 'teacher') {
    return [
      ...(dashboard.classroomPerformance || []).map((item) => ({ type: 'classroom', name: item.name, students: item.studentCount, attempts: item.totalAttempts, score: item.averageScore })),
      ...(dashboard.analytics?.atRiskStudents || []).map((item) => ({ type: 'at-risk', name: item.name, attempts: item.attempts, score: item.averageScore, risk: item.risk })),
    ];
  }
  return [
    ...(dashboard.analytics?.growthSummary || []).map((item) => ({ type: 'growth', name: item.label, value: item.value })),
    ...(dashboard.analytics?.platformHealth || []).map((item) => ({ type: 'health', name: item.label, value: item.value })),
  ];
}

function toCsv(rows) {
  if (!rows.length) return 'type,name,value\n';
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n');
}

function toPdf(report) {
  const rows = report.rows.length ? report.rows : [{ type: 'summary', name: 'No analytics rows available', value: '' }];
  const lines = [
    'StudySparkAI Analytics Report',
    `Role: ${report.role}`,
    `Generated: ${report.generatedAt}`,
    '',
    ...rows.slice(0, 35).map((row) => Object.entries(row).map(([key, value]) => `${key}: ${value ?? ''}`).join(' | ')),
  ];
  return buildSimplePdf(lines);
}

function buildSimplePdf(lines) {
  const escapePdf = (value) => String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = ['BT', '/F1 12 Tf', '50 780 Td', '14 TL', ...lines.map((line, index) => `${index ? 'T* ' : ''}(${escapePdf(line).slice(0, 105)}) Tj`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n');
  pdf += `\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function buildStudentRecommendations({ averageScore, attempts, assignments, subjects }) {
  const weakest = [...subjects].sort((a, b) => (a.averageScore || 0) - (b.averageScore || 0))[0];
  return [
    attempts < 3 ? 'Attempt at least three quizzes to unlock richer progress trends.' : 'Review your last three quiz explanations before the next attempt.',
    averageScore < 70 ? 'Focus on fundamentals and retake low-scoring topics this week.' : 'Try a harder quiz difficulty to keep momentum high.',
    assignments < 2 ? 'Generate an AI assignment for your current classroom topic.' : 'Convert one saved assignment into revision notes.',
    weakest ? `Spend 20 minutes revising ${weakest._id || 'your weakest subject'} based on recent scores.` : 'Join a classroom or take a quiz to receive subject recommendations.',
  ];
}

function buildTeacherInsights({ classroomPerformance, scoreBands, quizInsights, averageScore }) {
  const atRiskBand = scoreBands.find((band) => band.label === 'Needs help')?.count || 0;
  const weakestClass = [...classroomPerformance].sort((a, b) => a.averageScore - b.averageScore)[0];
  const hardestQuiz = quizInsights[0];
  return [
    averageScore < 70 ? 'Class average is below target; schedule a revision session.' : 'Class average is healthy; introduce enrichment activities.',
    atRiskBand > 0 ? `${atRiskBand} submitted attempts are in the needs-help band.` : 'No attempts currently fall in the needs-help band.',
    weakestClass ? `${weakestClass.name} has the lowest average score at ${weakestClass.averageScore}%.` : 'Create a classroom to start class analytics.',
    hardestQuiz ? `${hardestQuiz.title} is the most challenging quiz with ${hardestQuiz.averageScore}% average.` : 'Publish quizzes to generate item-level insights.',
  ];
}

function getDefaultDashboard(role) {
  const roleData = {
    student: {
      stats: [{ label: 'Quizzes attempted', value: 0, icon: 'BrainCircuit', color: 'from-blue-500 to-cyan-400' }, { label: 'Average score', value: '0%', icon: 'Target', color: 'from-slate-400 to-slate-500' }, { label: 'Assignments', value: 0, icon: 'FileText', color: 'from-violet-500 to-fuchsia-400' }, { label: 'Learning streak', value: '0 days', icon: 'Zap', color: 'from-slate-400 to-slate-500' }],
      recentAttempts: [],
      performanceTrend: [],
      actions: ['Generate Assignment', 'Join Classroom', 'Take Quiz', 'Open AI Chat'],
      modules: ['Personalized dashboard', 'Classroom joining', 'Quiz taking', 'Progress analytics', 'Gamification'],
    },
    teacher: {
      stats: [{ label: 'Total students', value: 0, icon: 'Users', color: 'from-blue-500 to-indigo-400' }, { label: 'Active quizzes', value: 0, icon: 'BookOpen', color: 'from-violet-500 to-fuchsia-400' }, { label: 'Total attempts', value: 0, icon: 'Activity', color: 'from-cyan-400 to-teal-500' }, { label: 'Average score', value: '0%', icon: 'Target', color: 'from-slate-400 to-slate-500' }],
      classroomPerformance: [],
      performanceDistribution: [],
      actions: ['Create Classroom', 'Generate Quiz from PDF', 'Monitor Students', 'Send Announcement'],
      modules: ['Classroom management', 'AI quiz generator', 'Student monitoring', 'Messaging', 'Resources'],
    },
    admin: {
      stats: [{ label: 'Total users', value: 0, icon: 'Users', color: 'from-blue-500 to-indigo-400' }, { label: 'Active (7 days)', value: 0, icon: 'Activity', color: 'from-slate-400 to-slate-500' }, { label: 'Quizzes created', value: 0, icon: 'BookOpen', color: 'from-violet-500 to-fuchsia-400' }, { label: 'Total attempts', value: 0, icon: 'BrainCircuit', color: 'from-slate-400 to-slate-500' }],
      userBreakdown: { students: 0, teachers: 0, admins: 0, total: 0 },
      usageTrend: [],
      totalAssignments: 0,
      lastUpdated: new Date().toISOString(),
      actions: ['Manage Users', 'Review Audit Logs', 'Moderate Content', 'Configure System'],
      modules: ['User management', 'Permission matrix', 'Content moderation', 'Platform analytics', 'System configuration'],
    },
  };
  return roleData[role] || roleData.student;
}