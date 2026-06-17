const WORK_STATUS_LABELS = {
  active: 'Active',
  in_progress: 'In Progress',
  submitted: 'Submitted',
  approved: 'Approved',
  completed: 'Completed',
  open: 'Active',
  delivered: 'Submitted',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
};

const getWorkStatus = (job) => {
  if (!job) {
    return { key: 'active', label: WORK_STATUS_LABELS.active };
  }

  const status = job.status;
  const escrowStatus = job.escrowStatus;

  if (status === 'completed' || escrowStatus === 'released') {
    return { key: 'completed', label: WORK_STATUS_LABELS.completed };
  }

  if (status === 'cancelled') {
    return { key: 'cancelled', label: WORK_STATUS_LABELS.cancelled };
  }

  if (status === 'disputed') {
    return { key: 'disputed', label: WORK_STATUS_LABELS.disputed };
  }

  if (status === 'delivered') {
    if (job.approvedAt) {
      return { key: 'approved', label: WORK_STATUS_LABELS.approved };
    }
    return { key: 'submitted', label: WORK_STATUS_LABELS.submitted };
  }

  if (status === 'in_progress') {
    if (escrowStatus === 'funded') {
      return { key: 'in_progress', label: WORK_STATUS_LABELS.in_progress };
    }
    if (job.freelancerId) {
      return { key: 'active', label: WORK_STATUS_LABELS.active };
    }
    return { key: 'in_progress', label: WORK_STATUS_LABELS.in_progress };
  }

  if (job.freelancerId && status === 'open') {
    return { key: 'active', label: WORK_STATUS_LABELS.active };
  }

  return {
    key: status || 'active',
    label: WORK_STATUS_LABELS[status] || WORK_STATUS_LABELS.active,
  };
};

const enrichJobWithWorkStatus = (job) => {
  const plain = job?.toObject ? job.toObject() : { ...(job || {}) };
  const { key, label } = getWorkStatus(plain);
  return {
    ...plain,
    workStatus: key,
    workStatusLabel: label,
  };
};

module.exports = {
  WORK_STATUS_LABELS,
  getWorkStatus,
  enrichJobWithWorkStatus,
};
