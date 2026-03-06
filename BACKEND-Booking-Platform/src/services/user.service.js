// src/services/user.service.js
const crypto = require('crypto');
const { generateNumericId } = require('../utils/id.generator');
const userRepo = require('../repositories/user.repo');
const { signAccess, signRefresh } = require('../utils/jwt.helper');
const bcrypt = require('bcrypt');

async function ensureUniqueUserId() {
  // attempt a few times to avoid collision
  for (let i = 0; i < 5; i++) {
    const candidate = generateNumericId(16);
    const existing = await userRepo.findByUserId(candidate);
    if (!existing) return candidate;
  }
  throw new Error('Failed to generate unique userId');
}

async function register({ firstName, lastName, email, password, role }) {
  const existing = await userRepo.findByEmail(email);
  if (existing) {
    const err = new Error('Email already in use');
    err.status = 409;
    throw err;
  }
  const userId = await ensureUniqueUserId();
  const userObj = {
    userId,
    firstName,
    lastName,
    emails: [{ value: email.toLowerCase(), primary: true }],
    passwordHash: password,
    role
  };
  const created = await userRepo.createUser(userObj);
  return created;
}

async function authenticate({ email, password }) {
  const user = await userRepo.findByEmail(email);
  if (!user) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }
  // generate tokens
  const payload = { userId: user.userId, role: user.role };
  const accessToken = signAccess(payload);
  const refreshToken = signRefresh({ userId: user.userId });
  // store hashed refresh token server-side
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await userRepo.addRefreshToken(user.userId, tokenHash);
  return { user, accessToken, refreshToken };
}

async function logout(userId, refreshToken) {
  if (!refreshToken) return;
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await userRepo.removeRefreshToken(userId, tokenHash);
}

async function getPublicProfile(userId) {
  const user = await userRepo.findPublicById(userId);
  if (!user) return null;
  return user.toPublicJSON();
}

async function updateProfile(userId, patch) {
  // prevent role/status changes here
  delete patch.role;
  delete patch.status;
  if (patch.password) {
    patch.passwordHash = patch.password;
    delete patch.password;
  }
  const updated = await userRepo.updateByUserId(userId, patch);
  return updated;
}

async function changeRole(adminUser, targetUserId, newRole) {
  if (adminUser.role !== 'administrator') {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  const updated = await userRepo.updateByUserId(targetUserId, { role: newRole });
  // TODO: create audit log entry
  return updated;
}

module.exports = {
  register,
  authenticate,
  logout,
  getPublicProfile,
  updateProfile,
  changeRole
};
