const crypto = require('crypto');
const mongoose = require('mongoose');

require('./config/loadEnv');

const User = require('./models/User');
const RefreshToken = require('./models/RefreshToken');
const Wallet = require('./models/Wallet');
const Gamification = require('./models/Gamification');
const { connectDatabase, disconnectDatabase } = require('./utils/mongoConnectionManager');

const TARGET_EMAILS = [
  'adewaleadedimeji2020@gmail.com',
  'scottros077@gmail.com',
  'scottros073@gmail.com'
];

const VALID_USER_TYPES = new Set(['client', 'freelancer', 'admin']);
const VALID_ROLES = new Set(['user', 'admin']);
const VALID_STATUSES = new Set(['active', 'suspended', 'banned']);
const VALID_AUTH_PROVIDERS = new Set(['email', 'google']);
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const VERIFICATION_CODE_TTL_MS = 30 * 60 * 1000;

const apply = process.argv.includes('--apply');
const deleteRelatedTestAccounts = process.argv.includes('--delete-related-tests');

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const mask = (value) => (value ? '[set]' : '[empty]');
const isTargetEmail = (email) => TARGET_EMAILS.includes(normalizeEmail(email));
const isRelatedTestEmail = (email) => {
  const normalized = normalizeEmail(email);
  return TARGET_EMAILS.some((target) => {
    const [local, domain] = target.split('@');
    const [candidateLocal, candidateDomain] = normalized.split('@');
    if (candidateDomain !== domain) return false;
    return candidateLocal === `${local}+test` ||
      candidateLocal === `${local}.test` ||
      candidateLocal.startsWith(`${local}+`) ||
      candidateLocal.startsWith(`test.${local}`) ||
      candidateLocal.startsWith(`${local}.duplicate`);
  });
};

const serializeDate = (date) => date ? new Date(date).toISOString() : null;

const summarizeUser = (user, tokenStats = null, resourceStats = null) => ({
  id: String(user._id),
  email: user.email,
  normalizedEmail: normalizeEmail(user.email),
  exists: true,
  verified: Boolean(user.verified),
  role: user.role || null,
  userType: user.userType || null,
  status: user.status || null,
  createdAt: serializeDate(user.createdAt),
  lastLogin: serializeDate(user.lastLogin),
  authProvider: user.authProvider || null,
  passwordHash: mask(user.password),
  passwordHashValid: user.authProvider === 'google' ? user.password == null : BCRYPT_RE.test(String(user.password || '')),
  googleId: mask(user.googleId),
  verificationToken: mask(user.verificationToken),
  verificationTokenExpiry: serializeDate(user.verificationTokenExpiry),
  resetPasswordToken: mask(user.resetPasswordToken),
  resetPasswordExpires: serializeDate(user.resetPasswordExpires),
  refreshTokens: tokenStats,
  resources: resourceStats
});

const getTokenStats = async (userId) => {
  const now = new Date();
  const [total, active, expired, revoked, staleRevoked] = await Promise.all([
    RefreshToken.countDocuments({ userId }),
    RefreshToken.countDocuments({ userId, revoked: false, expiresAt: { $gt: now } }),
    RefreshToken.countDocuments({ userId, expiresAt: { $lte: now } }),
    RefreshToken.countDocuments({ userId, revoked: true }),
    RefreshToken.countDocuments({
      userId,
      revoked: true,
      revokedAt: { $exists: true, $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    })
  ]);

  return { total, active, expired, revoked, staleRevoked };
};

const getResourceStats = async (userId, walletId) => {
  const walletIdLooksValid = mongoose.Types.ObjectId.isValid(walletId);
  const [walletByUser, walletById, gamification] = await Promise.all([
    Wallet.countDocuments({ userId }),
    walletIdLooksValid ? Wallet.countDocuments({ _id: walletId }) : Promise.resolve(0),
    Gamification.countDocuments({ userId })
  ]);

  return {
    walletByUser,
    walletById,
    walletFieldValidObjectId: !walletId || walletIdLooksValid,
    gamification
  };
};

const auditAndRepairAccountResources = async (user, report) => {
  const existingWallet = await Wallet.findOne({ userId: user._id }).lean();
  const existingGamification = await Gamification.findOne({ userId: user._id }).lean();
  const walletFieldMatches = existingWallet && String(user.wallet || '') === String(existingWallet._id);

  const problems = [];
  if (!existingWallet) problems.push('missing wallet record');
  if (existingWallet && !walletFieldMatches) problems.push('broken user.wallet reference');
  if (!existingGamification) problems.push('missing gamification record');

  if (!problems.length) return;

  report.problemsFound.push({
    type: 'inconsistent_account_resources',
    userId: String(user._id),
    email: user.email,
    reasons: problems
  });

  if (!apply) return;

  const wallet = existingWallet || await Wallet.findOneAndUpdate(
    { userId: user._id },
    { $setOnInsert: { userId: user._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  if (wallet?._id && String(user.wallet || '') !== String(wallet._id)) {
    await User.updateOne({ _id: user._id }, { $set: { wallet: wallet._id } }, { runValidators: true });
  }

  if (!existingGamification) {
    await Gamification.updateOne(
      { userId: user._id },
      { $setOnInsert: { userId: user._id } },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  report.accountsRepaired.push({
    userId: String(user._id),
    email: user.email,
    repairs: problems
  });
};

const buildRepair = (user) => {
  const set = {};
  const unset = {};
  const reasons = [];
  const now = new Date();

  const normalizedEmail = normalizeEmail(user.email);
  if (user.email !== normalizedEmail) {
    set.email = normalizedEmail;
    reasons.push('normalized email casing/whitespace');
  }

  if (!VALID_AUTH_PROVIDERS.has(user.authProvider)) {
    set.authProvider = user.googleId ? 'google' : 'email';
    reasons.push('normalized authProvider');
  }

  const authProvider = set.authProvider || user.authProvider || 'email';
  if (authProvider === 'email') {
    if (!BCRYPT_RE.test(String(user.password || ''))) {
      reasons.push('email account has missing/invalid password hash; password reset required');
    }

    if (!user.verified && (!user.verificationToken || !user.verificationTokenExpiry || user.verificationTokenExpiry <= now)) {
      set.verificationToken = crypto.randomInt(100000, 1000000).toString();
      set.verificationTokenExpiry = new Date(Date.now() + VERIFICATION_CODE_TTL_MS);
      reasons.push('regenerated missing/expired verification token');
    }
  }

  if (authProvider === 'google') {
    if (!user.verified) {
      set.verified = true;
      set.verificationDate = user.verificationDate || now;
      reasons.push('marked Google OAuth account verified');
    }
    if (user.verificationToken) {
      unset.verificationToken = '';
      reasons.push('removed verification token from Google OAuth account');
    }
    if (user.verificationTokenExpiry) {
      unset.verificationTokenExpiry = '';
      reasons.push('removed verification token expiry from Google OAuth account');
    }
  }

  if (!VALID_USER_TYPES.has(user.userType)) {
    set.userType = user.role === 'admin' ? 'admin' : 'freelancer';
    reasons.push('normalized userType');
  }

  const userType = set.userType || user.userType || 'freelancer';
  const expectedRole = userType === 'admin' ? 'admin' : 'user';
  if (!VALID_ROLES.has(user.role) || user.role !== expectedRole) {
    set.role = expectedRole;
    reasons.push('normalized role from userType');
  }

  if (!VALID_STATUSES.has(user.status)) {
    set.status = 'active';
    reasons.push('normalized invalid account status');
  }

  if (user.status === 'active') {
    if (user.suspensionReason) unset.suspensionReason = '';
    if (user.suspensionDate) unset.suspensionDate = '';
    if (user.suspensionReason || user.suspensionDate) reasons.push('cleared stale suspension metadata on active account');
  }

  if (user.resetPasswordToken && (!user.resetPasswordExpires || user.resetPasswordExpires <= now)) {
    unset.resetPasswordToken = '';
    unset.resetPasswordExpires = '';
    reasons.push('removed expired password reset token');
  }

  return { set, unset, reasons };
};

const applyRepair = async (user, repair) => {
  if (!repair.reasons.length) return;

  const update = {};
  if (Object.keys(repair.set).length) update.$set = repair.set;
  if (Object.keys(repair.unset).length) update.$unset = repair.unset;
  if (Object.keys(update).length) {
    await User.updateOne({ _id: user._id }, update, { runValidators: true });
  }
};

const pickDuplicateKeeper = (users) => {
  return [...users].sort((a, b) => {
    const aScore = (a.verified ? 100 : 0) + (a.lastLogin ? 20 : 0) + (BCRYPT_RE.test(String(a.password || '')) ? 10 : 0);
    const bScore = (b.verified ? 100 : 0) + (b.lastLogin ? 20 : 0) + (BCRYPT_RE.test(String(b.password || '')) ? 10 : 0);
    if (bScore !== aScore) return bScore - aScore;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  })[0];
};

const main = async () => {
  const connected = await connectDatabase();
  if (!connected) throw new Error('Database connection failed');

  const report = {
    mode: apply ? 'apply' : 'dry-run',
    targetEmails: TARGET_EMAILS,
    accounts: [],
    problemsFound: [],
    fixesApplied: [],
    accountsDeleted: [],
    accountsRepaired: [],
    remainingRisks: [],
    integrity: {}
  };

  const rawTargetUsers = await User.find({
    $expr: { $in: [{ $toLower: { $trim: { input: '$email' } } }, TARGET_EMAILS] }
  }).lean();

  const targetUsersByEmail = new Map();
  for (const user of rawTargetUsers) {
    const normalized = normalizeEmail(user.email);
    if (!targetUsersByEmail.has(normalized)) targetUsersByEmail.set(normalized, []);
    targetUsersByEmail.get(normalized).push(user);
  }

  for (const email of TARGET_EMAILS) {
    const users = targetUsersByEmail.get(email) || [];
    if (!users.length) {
      report.accounts.push({ email, exists: false });
      continue;
    }

    for (const user of users) {
      const [tokenStats, resourceStats] = await Promise.all([
        getTokenStats(user._id),
        getResourceStats(user._id, user.wallet)
      ]);
      report.accounts.push(summarizeUser(user, tokenStats, resourceStats));
    }
  }

  const duplicateGroups = await User.aggregate([
    {
      $group: {
        _id: { $toLower: { $trim: { input: '$email' } } },
        count: { $sum: 1 },
        ids: { $push: '$_id' },
        emails: { $push: '$email' }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]);

  for (const group of duplicateGroups) {
    report.problemsFound.push({
      type: 'duplicate_email_records',
      normalizedEmail: group._id,
      count: group.count,
      ids: group.ids.map(String),
      emails: group.emails
    });
  }

  const targetDuplicateGroups = duplicateGroups.filter((group) => TARGET_EMAILS.includes(group._id));
  for (const group of targetDuplicateGroups) {
    const users = await User.find({ _id: { $in: group.ids } }).lean();
    const keeper = pickDuplicateKeeper(users);
    for (const duplicate of users.filter((user) => String(user._id) !== String(keeper._id))) {
      const tokenStats = await getTokenStats(duplicate._id);
      const hasActiveTokens = tokenStats.active > 0;
      if (hasActiveTokens) {
        report.remainingRisks.push({
          type: 'duplicate_has_active_refresh_tokens',
          userId: String(duplicate._id),
          email: duplicate.email,
          activeRefreshTokens: tokenStats.active,
          action: 'not deleted automatically'
        });
        continue;
      }

      report.problemsFound.push({
        type: 'duplicate_user_record_selected_for_removal',
        normalizedEmail: group._id,
        keepUserId: String(keeper._id),
        deleteUserId: String(duplicate._id)
      });

      if (apply) {
        await RefreshToken.deleteMany({ userId: duplicate._id });
        await Wallet.deleteMany({ userId: duplicate._id });
        await Gamification.deleteMany({ userId: duplicate._id });
        await User.deleteOne({ _id: duplicate._id });
        report.accountsDeleted.push({ userId: String(duplicate._id), email: duplicate.email, reason: 'duplicate target email' });
      }
    }
  }

  const relatedTestUsers = await User.find({
    email: { $regex: /(test|duplicate)/i }
  }).lean();

  for (const user of relatedTestUsers.filter((candidate) => isRelatedTestEmail(candidate.email))) {
    const tokenStats = await getTokenStats(user._id);
    report.problemsFound.push({
      type: 'related_test_account_found',
      userId: String(user._id),
      email: user.email,
      activeRefreshTokens: tokenStats.active
    });

    if (apply && deleteRelatedTestAccounts && tokenStats.active === 0) {
      await RefreshToken.deleteMany({ userId: user._id });
      await Wallet.deleteMany({ userId: user._id });
      await Gamification.deleteMany({ userId: user._id });
      await User.deleteOne({ _id: user._id });
      report.accountsDeleted.push({ userId: String(user._id), email: user.email, reason: 'related test account' });
    }
  }

  const usersToAudit = await User.find({
    _id: { $in: rawTargetUsers.map((user) => user._id) }
  }).lean();

  for (const user of usersToAudit) {
    const repair = buildRepair(user);
    if (repair.reasons.length) {
      report.problemsFound.push({
        type: 'inconsistent_account_state',
        userId: String(user._id),
        email: user.email,
        reasons: repair.reasons
      });

      if (apply) {
        await applyRepair(user, repair);
        report.accountsRepaired.push({ userId: String(user._id), email: user.email, repairs: repair.reasons });
      }
    }

    await auditAndRepairAccountResources(user, report);
  }

  const now = new Date();
  const orphanedRefreshTokens = await RefreshToken.aggregate([
    {
      $match: {
        $expr: {
          $regexMatch: {
            input: { $toString: '$userId' },
            regex: /^[a-fA-F0-9]{24}$/
          }
        }
      }
    },
    { $addFields: { userObjectId: { $toObjectId: { $toString: '$userId' } } } },
    {
      $lookup: {
        from: 'users',
        localField: 'userObjectId',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $match: { user: { $size: 0 } } },
    { $project: { _id: 1, userId: 1, revoked: 1, expiresAt: 1 } }
  ]);

  const expiredTokenFilter = { expiresAt: { $lte: now } };
  const staleRevokedFilter = {
    revoked: true,
    revokedAt: { $exists: true, $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
  };
  const adminTokenFilter = { userId: 'admin-user-id' };

  const [expiredCount, staleRevokedCount, adminTokenCount] = await Promise.all([
    RefreshToken.countDocuments(expiredTokenFilter),
    RefreshToken.countDocuments(staleRevokedFilter),
    RefreshToken.countDocuments(adminTokenFilter)
  ]);

  if (orphanedRefreshTokens.length) {
    report.problemsFound.push({
      type: 'orphaned_refresh_tokens',
      count: orphanedRefreshTokens.length,
      samples: orphanedRefreshTokens.slice(0, 10).map((token) => ({
        id: String(token._id),
        userId: String(token.userId),
        revoked: Boolean(token.revoked),
        expiresAt: serializeDate(token.expiresAt)
      }))
    });
  }

  if (expiredCount) report.problemsFound.push({ type: 'expired_refresh_tokens', count: expiredCount });
  if (staleRevokedCount) report.problemsFound.push({ type: 'stale_revoked_refresh_tokens', count: staleRevokedCount });
  if (adminTokenCount) report.problemsFound.push({ type: 'admin_refresh_tokens_should_not_exist', count: adminTokenCount });

  if (apply) {
    const [expiredDelete, staleDelete, adminDelete] = await Promise.all([
      RefreshToken.deleteMany(expiredTokenFilter),
      RefreshToken.deleteMany(staleRevokedFilter),
      RefreshToken.deleteMany(adminTokenFilter)
    ]);

    const orphanIds = orphanedRefreshTokens.map((token) => token._id);
    const orphanDelete = orphanIds.length ? await RefreshToken.deleteMany({ _id: { $in: orphanIds } }) : { deletedCount: 0 };

    report.fixesApplied.push(
      { type: 'deleted_expired_refresh_tokens', deletedCount: expiredDelete.deletedCount },
      { type: 'deleted_stale_revoked_refresh_tokens', deletedCount: staleDelete.deletedCount },
      { type: 'deleted_admin_refresh_tokens', deletedCount: adminDelete.deletedCount },
      { type: 'deleted_orphaned_refresh_tokens', deletedCount: orphanDelete.deletedCount }
    );
  }

  const postDuplicateGroups = await User.aggregate([
    {
      $group: {
        _id: { $toLower: { $trim: { input: '$email' } } },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]);

  const postTargetUsers = await User.find({
    $expr: { $in: [{ $toLower: { $trim: { input: '$email' } } }, TARGET_EMAILS] }
  }).lean();

  report.integrity = {
    oneUserPerTargetEmail: TARGET_EMAILS.every((email) => postTargetUsers.filter((user) => normalizeEmail(user.email) === email).length <= 1),
    duplicateEmailGroupsRemaining: postDuplicateGroups.length,
    targetAccountsWithInvalidPasswordHash: postTargetUsers
      .filter((user) => user.authProvider !== 'google' && !BCRYPT_RE.test(String(user.password || '')))
      .map((user) => ({ userId: String(user._id), email: user.email })),
    targetUnverifiedAccountsWithValidVerificationFlow: postTargetUsers
      .filter((user) => !user.verified)
      .every((user) => Boolean(user.verificationToken && user.verificationTokenExpiry && user.verificationTokenExpiry > now)),
    refreshTokenSystemHasOnlyObjectIdUserIdsForStoredUserTokens: await RefreshToken.countDocuments({ userId: 'admin-user-id' }) === 0,
    activeTargetRefreshTokens: await Promise.all(postTargetUsers.map(async (user) => ({
      userId: String(user._id),
      email: user.email,
      activeRefreshTokens: await RefreshToken.countDocuments({ userId: user._id, revoked: false, expiresAt: { $gt: now } })
    })))
  };

  if (report.integrity.targetAccountsWithInvalidPasswordHash.length) {
    report.remainingRisks.push({
      type: 'password_reset_required',
      accounts: report.integrity.targetAccountsWithInvalidPasswordHash
    });
  }

  console.log(JSON.stringify(report, null, 2));
};

main()
  .catch((error) => {
    console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
