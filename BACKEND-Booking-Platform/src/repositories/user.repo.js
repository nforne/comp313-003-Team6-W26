// src/repositories/user.repo.js
const User = require('../models/user.model');

async function createUser(userObj) {
  const user = new User(userObj);
  return user.save();
}

async function findByUserId(userId) {
  return User.findOne({ userId }).select('+passwordHash').exec();
}

async function findByEmail(email) {
  return User.findOne({ 'emails.value': email.toLowerCase() }).select('+passwordHash').exec();
}

async function findPublicById(userId) {
  return User.findOne({ userId }).exec();
}

async function updateByUserId(userId, patch) {
  patch.updatedAt = Date.now();
  return User.findOneAndUpdate({ userId }, { $set: patch }, { new: true }).exec();
}

async function addRefreshToken(userId, tokenHash) {
  return User.findOneAndUpdate({ userId }, { $push: { refreshTokens: { tokenHash, createdAt: Date.now() } } }, { new: true }).exec();
}

async function removeRefreshToken(userId, tokenHash) {
  return User.findOneAndUpdate({ userId }, { $pull: { refreshTokens: { tokenHash } } }, { new: true }).exec();
}

module.exports = {
  createUser,
  findByUserId,
  findByEmail,
  findPublicById,
  updateByUserId,
  addRefreshToken,
  removeRefreshToken
};
