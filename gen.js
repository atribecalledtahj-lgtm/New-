// Static site generator: config -> single-file, mobile-first, SEO-ready HTML.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PRESETS = {
  plumbing: { schema: 'Plumber', color: '#1d5fd0', tag: 'Fast, honest plumbing repairs', services: ['Emergency leak repair', 'Drain cleaning', 'Water heater install & repair', 'Fixture installation', 'Repiping'] },
  hvac: { schema: 'HVACBusiness', color: '#c2410c', tag: 'Comfort you can count on, all year', services: ['AC repair & install', 'Heating & furnace service', 'Seasonal tune-ups', 'Duct cleaning', 'Thermostat upgrades'] },
  salon: { schema: 'HairSalon', color: '#9d2a6b', tag: 'Look great. Feel great.', services: ['Cuts & styling', 'Color & highlights', 'Treatments', 'Blowouts', 'Special-occasion hair'] },
  barber: { schema: 'BarberShop', color: '#1f2937', tag: 'Sharp cuts, no waiting around', services: ['Haircuts', 'Fades & tapers', 'Beard trims', 'Hot-towel shaves', 'Kids cuts'] },
  restaurant: { schema: 'Restaurant', color: '#b91c1c', tag: 'Good food, made fresh', services: ['Dine-in', 'Takeout', 'Catering', 'Daily specials'] },
  dental: { schema: 'Dentist', color: '#0f766e', tag: 'Gentle care for the whole family', services: ['Cleanings & exams', 'Fillings', 'Whitening', 'Emergency visits', 'Kids dentistry'] },
  generic: { schema: 'LocalBusiness', color: '#2f5bea', tag: 'Local service you can trust', services: ['Quality service', 'Fair pricing', 'Friendly support'] }
};
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'site';

function renderSite(c) {
  const p = PRESETS[c.niche] || PRESETS.generic;
  const color = /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : p.color;
  const services = c.services ? String(c.services).split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : p.services;
  const tag = c.tagline || p.tag;
  const about = c.about || `${c.name} proudly serves ${c.city || 'the local community'}. Call us today for friendly, reliable service.`;
  const ld = { '@context': 'https://schema.org', '@type': p.schema, name: c.name, telephone: c.phone || undefined, email: c.email || undefined, areaServed: c.city || undefined, description: about };
  const tel = c.phone ? c.phone.replace(/[^+\d]/g, '') : '';
  const cta = c.phone ? `<a class="btn" href="tel:${esc(tel)}">Call ${esc(c.phone)}</a>` : (c.email ? `<a class="btn" href="mailto:${esc(c.email)}">Email us</a>` : '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.name)}${c.city ? ' – ' + esc(c.city) : ''}</title><meta name="description" content="${esc(tag)}. ${esc(about).slice(0, 140)}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>:root{--c:${color}}*{box-sizing:border-box}body{margin:0;font:17px/1.6 system-ui,-apple-system,sans-serif;color:#1b1f27}
.w{max-width:960px;margin:0 auto;padding:0 18px}header{background:var(--c);color:#fff;padding:64px 0 56px}
h1{font-size:clamp(30px,6vw,52px);line-height:1.1;margin:0 0 12px}header p{font-size:20px;opacity:.95;margin:0 0 24px}
.btn{display:inline-block;background:#fff;color:var(--c);font-weight:700;padding:13px 24px;border-radius:10px;text-decoration:none}
section{padding:44px 0}h2{margin:0 0 16px;color:var(--c)}ul{list-style:none;padding:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
li{background:#f4f6fa;border-radius:10px;padding:16px;font-weight:600}footer{background:#f4f6fa;padding:28px 0;color:#555;font-size:15px}</style></head>
<body><header><div class="w"><h1>${esc(c.name)}</h1><p>${esc(tag)}${c.city ? ' · ' + esc(c.city) : ''}</p>${cta}</div></header>
<main class="w"><section><h2>Our services</h2><ul>${services.map(s => `<li>${esc(s)}</li>`).join('')}</ul></section>
<section><h2>About us</h2><p>${esc(about)}</p></section>
<section><h2>Get in touch</h2><p>${c.phone ? 'Phone: <a href="tel:' + esc(tel) + '">' + esc(c.phone) + '</a><br>' : ''}${c.email ? 'Email: <a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a><br>' : ''}${c.hours ? 'Hours: ' + esc(c.hours) : ''}</p></section></main>
<footer><div class="w">© ${new Date().getFullYear()} ${esc(c.name)}${c.city ? ' · ' + esc(c.city) : ''}</div></footer></body></html>`;
}
module.exports = { renderSite, slugify, PRESETS, esc };
