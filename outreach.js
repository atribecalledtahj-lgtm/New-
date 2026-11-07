// Builds compliant (CAN-SPAM-style) outreach drafts. Never invents observations.
const crypto = require('crypto');
const sign = (id, secret) => crypto.createHmac('sha256', secret).update('unsub:' + id).digest('hex').slice(0, 24);
const unsubToken = (id, secret) => id + '.' + sign(id, secret);
function verifyUnsub(t, secret) {
  const [id, sig] = String(t || '').split('.');
  if (!id || !sig || !secret) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(id, secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? +id : null;
}
function build(p, env) {
  const biz = env.BUSINESS_NAME, addr = env.BUSINESS_ADDRESS, base = env.BASE_URL, from = env.OWNER_NAME || biz;
  const problems = [];
  if (!biz) problems.push('BUSINESS_NAME');
  if (!addr) problems.push('BUSINESS_ADDRESS');
  if (!env.ADMIN_TOKEN) problems.push('ADMIN_TOKEN');
  const obs = p.current_site ? p.observation.trim() : `I couldn't find a website for ${p.name}`;
  if (!obs) problems.push('observation (a true, specific note about their current site)');
  if (!p.email) problems.push('prospect email');
  const preview = `${base}/preview/${p.slug}`;
  const body = `Hi ${p.name} team,

${obs.endsWith('.') ? obs : obs + '.'} I build simple, fast websites for local businesses, so I put together a free sample homepage for you to look at:

${preview}

If you like it, I can make it yours (your photos, hours and services, on your own domain) for a flat $${env.SETUP_PRICE || 500}, plus an optional $${env.MAINT_PRICE || 59}/month that covers hosting, security updates, backups and small edits. No obligation, and the sample is yours to look at either way.

Just reply to this email with any questions.

${from}
${biz}
${addr}

You received this one-time message because ${p.name} is a local business. To never hear from us again: ${base}/unsubscribe?t=${unsubToken(p.id, env.ADMIN_TOKEN || '')}`;
  return { problems, subject: `A free sample homepage for ${p.name}`, body, to: p.email };
}
module.exports = { build, verifyUnsub, unsubToken };
