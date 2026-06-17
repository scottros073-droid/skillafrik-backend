const APPLICATION_HIRED = 'accepted';
const APPLICATION_NOT_SELECTED = 'not_selected';

const applyHireToJob = (job, freelancerId, clientId) => {
  const hiredId = String(freelancerId);

  job.freelancerId = freelancerId;
  job.status = 'in_progress';
  job.assignedBy = clientId;
  job.assignedAt = job.assignedAt || new Date();
  job.hiredAt = new Date();

  job.applications = (job.applications || []).map((application) => {
    const applicationFreelancerId = application.freelancerId?._id?.toString()
      || application.freelancerId?.toString()
      || String(application.freelancerId || '');
    const base = typeof application.toObject === 'function' ? application.toObject() : { ...application };
    return {
      ...base,
      status: applicationFreelancerId === hiredId ? APPLICATION_HIRED : APPLICATION_NOT_SELECTED,
    };
  });

  return job;
};

const isJobApplicant = (job, userId) => {
  const targetId = String(userId);
  return (job.applications || []).some((application) => {
    const applicantId = application.freelancerId?._id?.toString()
      || application.freelancerId?.toString()
      || String(application.freelancerId || '');
    return applicantId === targetId;
  });
};

module.exports = {
  APPLICATION_HIRED,
  APPLICATION_NOT_SELECTED,
  applyHireToJob,
  isJobApplicant,
};
