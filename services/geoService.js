// filepath: backend/services/geoService.js
const mongoose = require('mongoose');

// ===== GEOSPATIAL INDEX NAME =====
const GEO_INDEX_NAME = 'location_2dsphere';

// ===== CREATE GEOSPATIAL INDEX =====
const createGeoIndex = (schema) => {
  schema.index({ location: '2dsphere' }, { name: GEO_INDEX_NAME });
};

// ===== FIND JOBS NEAR LOCATION =====
const findJobsNearLocation = async (Job, { latitude, longitude }, radiusKm = 10, query = {}) => {
  return Job.find({
    ...query,
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: radiusKm * 1000 // Convert to meters
      }
    }
  });
};

// ===== FIND USERS NEAR LOCATION =====
const findUsersNearLocation = async (User, { latitude, longitude }, radiusKm = 10, query = {}) => {
  return User.find({
    ...query,
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: radiusKm * 1000
      }
    }
  });
};

// ===== CALCULATE DISTANCE BETWEEN TWO POINTS =====
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRad = (deg) => deg * (Math.PI / 180);

// ===== GET USER LOCATION =====
const getUserLocation = (user) => {
  if (!user.location || !user.location.coordinates) {
    return null;
  }
  return {
    latitude: user.location.coordinates[1],
    longitude: user.location.coordinates[0]
  };
};

// ===== FORMAT LOCATION =====
const formatLocation = (location) => {
  if (!location) return null;
  
  return {
    type: location.type || 'Point',
    coordinates: location.coordinates || [location.longitude, location.latitude],
    address: location.address || null,
    city: location.city || null,
    state: location.state || null,
    country: location.country || null
  };
};

// ===== VALIDATE COORDINATES =====
const isValidCoordinates = (lat, lng) => {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
};

// ===== GET NEARBY JOBS AGGREGATION =====
const getNearbyJobsAggregation = (Job, { latitude, longitude }, radiusKm = 10, limit = 20) => {
  return Job.aggregate([
    {
      $geoNear: {
        near: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        distanceField: 'distance',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: { isLocal: true, status: 'open' }
      }
    },
    {
      $sort: {
        isUrgent: -1,
        distance: 1,
        createdAt: -1
      }
    },
    {
      $limit: limit
    }
  ]);
};

// ===== SEARCH JOBS BY SKILLS AND LOCATION =====
const searchJobsBySkillsAndLocation = async (Job, { latitude, longitude }, skills, radiusKm = 10) => {
  return Job.find({
    isLocal: true,
    status: 'open',
    skills: { $in: skills },
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: radiusKm * 1000
      }
    }
  }).sort({ isUrgent: -1, createdAt: -1 });
};

module.exports = {
  createGeoIndex,
  findJobsNearLocation,
  findUsersNearLocation,
  calculateDistance,
  getUserLocation,
  formatLocation,
  isValidCoordinates,
  getNearbyJobsAggregation,
  searchJobsBySkillsAndLocation,
  GEO_INDEX_NAME
};