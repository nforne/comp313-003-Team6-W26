// src/utils/notification.stub.js
// Notification stub: accepts provider userIds (not serviceIds) and metadata.
// Replace with real integration (email/push/queue) later.

function notifyProviders({ providerIds = [], message = '', metadata = {} }) {
  // ensure unique provider list
  const unique = Array.from(new Set(providerIds || []));
  // non-blocking: log and return a resolved promise with recipients
  console.info('[notification.stub] notifyProviders', { to: unique.length, providerIds: unique, message, metadata });
  // In production: push to queue or call email/push service
  return Promise.resolve({ sentTo: unique });
}

module.exports = { notifyProviders };
