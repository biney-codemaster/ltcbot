function isOwner(userId, ownerId) {
  if (!ownerId || !userId) return false;
  return String(userId) === String(ownerId);
}

function formatDuration(ms) {
  if (ms <= 0) return 'expired';

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
}

function formatTimestamp(ms) {
  return `<t:${Math.floor(ms / 1000)}:F> (<t:${Math.floor(ms / 1000)}:R>)`;
}

function sanitizeChannelName(username) {
  return `slot-${username}`
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90) || 'slot-user';
}

module.exports = {
  isOwner,
  formatDuration,
  formatTimestamp,
  sanitizeChannelName,
};
