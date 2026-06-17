const isAdminUser = (user) => (
  user?._id === 'admin-user-id' ||
  user?.id === 'admin-user-id' ||
  user?.userType === 'admin' ||
  user?.role === 'admin'
);

const getAccountAccessFailure = (user, options = {}) => {
  const { requireVerified = true } = options;

  if (!user) {
    return {
      status: 401,
      message: 'Invalid authentication session',
      data: {}
    };
  }

  if (isAdminUser(user)) return null;

  if (user.status === 'suspended') {
    return {
      status: 403,
      message: `Account suspended: ${user.suspensionReason || 'No reason provided'}`,
      data: {}
    };
  }

  if (user.status === 'banned') {
    return {
      status: 403,
      message: 'Account banned',
      data: {}
    };
  }

  if (user.status && user.status !== 'active') {
    return {
      status: 403,
      message: 'Account is not active',
      data: {}
    };
  }

  if (requireVerified && user.verified !== true) {
    return {
      status: 403,
      message: 'Please verify your email before logging in.',
      data: {
        requiresVerification: true,
        email: user.email
      }
    };
  }

  return null;
};

module.exports = {
  getAccountAccessFailure,
  isAdminUser
};
