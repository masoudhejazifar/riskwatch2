(function () {
'use strict';
const E = window.Engine, D = window.DemoData;
const $ = id => document.getElementById(id);
const HOUR = 3600e3, MIN = 60e3;
const fa = n => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

/* ---------- ذخیره‌سازی (خطا نیاید حتی اگر ممنوع باشد) ---------- */
function load(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

let settings = Object.assign({ demo: true, interval: 5, weights: {}, sources: {} }, load('wr_settings', {}));
let acks = load('wr_acks', []);
let history = load('wr_hist', []);
let flightSamples = load('wr_flights', []);
let lastFlightT = load('wr_flightT', 0);
const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

const S = {
  events: [], rejected: [], verified: [], health: {}, scenario: 'calm',
  result: null, alert: { level: 'none' }, ready: { level: 'none' }, flightExt: { risk: null, note: 'هنوز اندازه‌گیری نشده' }, textCache: {}, netFails: 0, checking: false, timer: null,
};
let activeAlarm = null; // { level, key }

/* ---------- شبکه ---------- */
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
function nativeHttp() { const c = window.Capacitor; return isNative && c && c.Plugins && c.Plugins.CapacitorHttp ? c.Plugins.CapacitorHttp : null; }
function shortErr(e) { return String((e && e.message) || e || 'خطا').replace(/\s+/g, ' ').slice(0, 60); }
async function httpText(url, timeout) {
  timeout = timeout || 12000;
  const H = nativeHttp();
  if (H) {   // درخواست مستقیم از شبکه اندروید: قفل CORS ندارد
    const r = await H.get({ url, headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml, text/html, application/json, */*', 'Accept-Language': 'fa,en;q=0.8' }, readTimeout: timeout, connectTimeout: timeout, responseType: 'text' });
    if (r.status >= 400) throw new Error('HTTP ' + r.status);
    return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  }
  const c = new AbortController(); const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, { signal: c.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
async function reach(url) {   // سرور جواب داد (حتی با خطا) یعنی اتصال هست
  try { await httpText(url, 7000); return true; } catch (e) { return /^HTTP/.test(shortErr(e)); }
}
async function probeInternet() {
  if (!navigator.onLine) { S.netFails = 0; return { risk: null, note: 'گوشی آفلاین است' }; }
  const [foreign, domestic] = await Promise.all([
    reach('https://www.cloudflare.com/cdn-cgi/trace'), reach('https://www.aparat.com/')]);
  if (!foreign && !domestic) {
    S.netFails++;
    return S.netFails >= 2 ? { risk: 70, note: 'سایت داخلی و خارجی هر دو باز نشد' } : { risk: 25, note: 'اختلال احتمالی، در انتظار بررسی دوباره' };
  }
  S.netFails = 0;
  return { risk: 15, note: foreign ? 'اینترنت عادی' : 'سایت خارجی بسته است (ممکن است فیلتر عادی باشد)' };
}

/* ---------- ترافیک هوایی (OpenSky، رایگان) ---------- */
const BOXES = [ { lamin: 25, lamax: 40, lomin: 44, lomax: 63.5 }, { lamin: 22, lamax: 37, lomin: 38, lomax: 56 } ];
async function fetchFlights(now) {
  if (now - lastFlightT < 25 * MIN && S.flightExt.risk !== undefined && flightSamples.length) {
    return E.flightRisk(flightSamples, flightSamples[flightSamples.length - 1].n, now);
  }
  try {
    let total = 0;
    for (const b of BOXES) {
      const t = await httpText('https://opensky-network.org/api/states/all?lamin=' + b.lamin + '&lomin=' + b.lomin + '&lamax=' + b.lamax + '&lomax=' + b.lomax, 15000);
      const st = (JSON.parse(t).states || []).filter(x => x[8] === false);
      total += st.length;
    }
    lastFlightT = now; save('wr_flightT', lastFlightT);
    const risk = E.flightRisk(flightSamples, total, now);
    flightSamples.push({ t: now, n: total });
    flightSamples = flightSamples.filter(x => now - x.t < 72 * HOUR).slice(-400);
    save('wr_flights', flightSamples);
    return risk;
  } catch (e) { return { risk: null, note: 'سرویس OpenSky جواب نداد (محدودیت روزانه یا اتصال)' }; }
}

/* ---------- پردازش خبرها (هم زنده، هم آزمایشی) ---------- */
async function processItems(items, now, allowFetch) {
  const events = [], rejected = [], verified = [];
  const seen = new Set();
  let fetches = 0;
  for (const it of items) {
    const key = it.link || it.title;
    if (seen.has(key)) continue; seen.add(key);
    const ts = it.ts || now;
    if (now - ts > 48 * HOUR) continue;
    events.push(...E.classify(Object.assign({}, it, { ts }), now));
    if (!E.looksLikeAttack(it) || now - ts > 6 * HOUR) continue;

    let item = Object.assign({}, it, { ts });
    if (!item.fullText && allowFetch && item.link) {
      let text = S.textCache[item.link];
      if (text === undefined && fetches < 10) {
        fetches++;
        try { text = E.extractArticleText(await httpText(item.link, 12000)); } catch (e) { text = ''; }
        S.textCache[item.link] = text;
      }
      if (text && text.length >= 200) item = Object.assign(item, { body: text, fullText: true });
    }
    const v = E.verifyAttack(item, now);
    if (v.ok) verified.push(Object.assign({}, item, v));
    else rejected.push({ title: item.title, source: item.source, reason: v.reason, ts });
  }
  return { events, rejected, verified };
}

async function collectLive(now) {
  const feeds = E.SOURCES.filter(s => settings.sources[s.id] !== false);
  const res = await Promise.allSettled(feeds.map(async s => {
    const xml = await httpText(s.url, 12000);
    const items = E.parseFeed(xml, s);
    return { s, items };
  }));
  const all = [];
  res.forEach((r, i) => {
    const s = feeds[i];
    const h = S.health[s.id] = S.health[s.id] || { ok: 0, fail: 0 };
    if (r.status === 'fulfilled') { h.ok++; h.last = now; h.count = r.value.items.length; h.state = 'ok'; all.push(...r.value.items); }
    else { h.fail++; h.state = 'bad'; h.err = shortErr(r.reason); }
  });
  return all;
}

async function runCheck() {
  if (S.checking) return; S.checking = true;
  $('btnCheck').textContent = 'در حال بررسی…';
  const now = Date.now();
  try {
    let items, internet, flights;
    if (settings.demo) {
      const sc = D.SCENARIOS[S.scenario];
      items = sc.items(now); internet = sc.internet; flights = sc.flights;
      S.health = {};
    } else {
      items = await collectLive(now);
      internet = await probeInternet();
      flights = await fetchFlights(now);
    }
    S.flightExt = flights;
    const r = await processItems(items, now, !settings.demo);
    S.events = r.events; S.rejected = r.rejected; S.verified = r.verified;
    S.alert = E.alertState(r.verified, now);
    S.ready = E.readinessState(r.events, now);
    S.result = E.computeScore(r.events, settings.weights, { internet, flights, alert: S.alert }, now);
    S.lastCheck = now;
    history.push({ t: now, s: S.result.final }); history = history.filter(h => now - h.t < 48 * HOUR).slice(-600);
    save('wr_hist', history);
    maybeAlarm();
  } catch (e) { console.error(e); }
  S.checking = false;
  $('btnCheck').textContent = 'بررسی الان';
  render(); schedule();
}

function schedule() {
  clearTimeout(S.timer);
  const hot = S.result && (S.result.final >= 50 || S.alert.level !== 'none' || S.ready.level !== 'none');
  const ms = hot ? 60e3 : Math.max(1, +settings.interval || 5) * MIN;
  S.timer = setTimeout(runCheck, ms);
}

/* ---------- آلارم ---------- */
let actx = null, sirenTimer = null, osc = null, vibTimer = null, wake = null;
function ensureCtx() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch (e) {}
  $('soundState').textContent = actx && actx.state === 'running' ? 'صدا: فعال' : 'صدا: با اولین لمس فعال می‌شود';
}
function startSound(full) {
  stopSound(); ensureCtx(); if (!actx) return;
  try {
    osc = actx.createOscillator(); const g = actx.createGain();
    osc.type = full ? 'sawtooth' : 'square'; g.gain.value = full ? 0.6 : 0.35;
    osc.connect(g); g.connect(actx.destination); osc.start();
    let hi = false;
    const step = () => { hi = !hi; osc.frequency.setValueAtTime(full ? (hi ? 1000 : 620) : (hi ? 880 : 0.001), actx.currentTime); };
    step(); sirenTimer = setInterval(step, full ? 450 : 500);
  } catch (e) {}
  try { if (navigator.vibrate) { const v = () => navigator.vibrate(full ? [600, 200, 600, 200, 600] : [300, 200, 300]); v(); vibTimer = setInterval(v, 2500); } } catch (e) {}
  try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(w => wake = w).catch(() => {}); } catch (e) {}
}
function stopSound() {
  clearInterval(sirenTimer); clearInterval(vibTimer); sirenTimer = vibTimer = null;
  try { if (osc) { osc.stop(); osc.disconnect(); } } catch (e) {} osc = null;
  try { navigator.vibrate && navigator.vibrate(0); } catch (e) {}
  try { if (wake) wake.release(); } catch (e) {} wake = null;
}
function showAlarm(level, info, isTest) {
  const el = $('alarm');
  el.className = 'on ' + (level === 'ready' ? 'standby' : level);
  $('alarmTitle').textContent = level === 'full' ? (isTest ? 'آلارم آزمایشی: جنگ آغاز شده' : 'جنگ آغاز شد') : level === 'ready' ? 'آماده‌باش خانواده' : (isTest ? 'آماده‌باش آزمایشی' : 'آماده‌باش');
  const cities = (info.cities && info.cities.length) ? ' در ' + info.cities.map(cityFa).join('، ') : '';
  $('alarmBody').textContent = isTest ? 'این فقط یک آزمایش است. صدا و نمایش را بررسی کنید.' :
    level === 'ready' ? 'نشانه‌های هشدار دیده شد (' + info.why + '). هنوز حمله‌ای تأیید نشده. مدارک، شارژ گوشی‌ها، آب و غذا و محل قرار خانواده را همین حالا آماده کنید.' :
    level === 'full' ? 'حمله' + cities + ' از چند منبع مستقل تأیید شد. در آماده‌باش کامل باشید.' :
    'یک منبع معتبر خبر حمله' + cities + ' را با متن کامل داده است. در حال تأیید از منبع دوم. آماده باشید.';
  $('alarmSrc').innerHTML = (info.items || []).map(i => '<div>• ' + esc(i.source) + ': ' + esc(i.title) + '</div>').join('') || '—';
  startSound(level === 'full');
  try { if (window.Notification && Notification.permission === 'granted') new Notification($('alarmTitle').textContent, { body: $('alarmBody').textContent, requireInteraction: true }); } catch (e) {}
}
function maybeAlarm() {
  let a = S.alert;
  if (a.level === 'none' && S.ready.level === 'ready') a = S.ready;
  if (a.level === 'none') { if (activeAlarm && !activeAlarm.test) hideAlarm(); return; }
  if (acks.includes(a.key)) return;
  if (activeAlarm && activeAlarm.key === a.key) return;
  activeAlarm = { level: a.level, key: a.key };
  showAlarm(a.level, a, false);
}
function hideAlarm() { $('alarm').className = ''; stopSound(); activeAlarm = null; }
$('btnAck').onclick = () => { if (activeAlarm && activeAlarm.key) { acks.push(activeAlarm.key); acks = acks.slice(-50); save('wr_acks', acks); } hideAlarm(); render(); };
$('btnMute').onclick = () => stopSound();
$('btnTest').onclick = () => {
  ensureCtx();
  activeAlarm = { level: 'full', key: null, test: true };
  showAlarm('full', { cities: ['Tehran'], items: [{ source: 'آزمایش', title: 'این یک آلارم آزمایشی است' }] }, true);
};

/* ---------- نمایش ---------- */
const CITY_FA = { Tehran:'تهران', Isfahan:'اصفهان', Tabriz:'تبریز', Shiraz:'شیراز', Mashhad:'مشهد', Bushehr:'بوشهر', Natanz:'نطنز', Fordow:'فردو', Parchin:'پارچین', BandarAbbas:'بندرعباس', Kermanshah:'کرمانشاه', Ahvaz:'اهواز', Karaj:'کرج', Qom:'قم', Arak:'اراک', Urmia:'ارومیه', Zahedan:'زاهدان', Hamedan:'همدان', Kharg:'خارک', Chabahar:'چابهار', Semnan:'سمنان', Iran:'ایران' };
const cityFa = c => CITY_FA[c] || c;
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c])); }
function ago(ts) {
  const m = Math.round((Date.now() - ts) / MIN);
  if (m < 1) return 'همین الان'; if (m < 60) return fa(m) + ' دقیقه پیش';
  const h = Math.round(m / 60); if (h < 48) return fa(h) + ' ساعت پیش'; return fa(Math.round(h / 24)) + ' روز پیش';
}
const LVL_COLOR = { calm: '#00c853', caution: '#ffc400', warning: '#ff7a00', critical: '#ff2b2b' };

/* نیم‌دایره: چپ سبز، راست قرمز */
function gaugeSVG(id, W, H, cx, cy, r, sw, nl, big) {
  const x1 = cx - r, x2 = cx + r;
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="' + (big ? 'main-g' : '') + '" id="' + id + '" aria-hidden="true">' +
    '<defs><linearGradient id="' + id + '-g" gradientUnits="userSpaceOnUse" x1="' + x1 + '" y1="0" x2="' + x2 + '" y2="0">' +
    '<stop offset="0" stop-color="#00d65a"/><stop offset=".28" stop-color="#8bd62a"/><stop offset=".5" stop-color="#ffc400"/><stop offset=".74" stop-color="#ff6a00"/><stop offset="1" stop-color="#e0001a"/></linearGradient></defs>' +
    '<path d="M ' + x1 + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + x2 + ' ' + cy + '" fill="none" stroke="url(#' + id + '-g)" stroke-width="' + sw + '"/>' +
    '<g class="needle" style="transform-origin:' + cx + 'px ' + cy + 'px;transform:rotate(-90deg)"><line x1="' + cx + '" y1="' + cy + '" x2="' + cx + '" y2="' + (cy - nl) + '" stroke="#fff" stroke-width="' + (big ? 5 : 3) + '" stroke-linecap="round"/></g>' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="' + (big ? 10 : 6) + '" fill="#fff"/></svg>';
}
function setGauge(id, score) {
  const el = $(id); if (!el) return;
  el.classList.toggle('g-off', score == null);
  el.querySelector('.needle').style.transform = 'rotate(' + ((score == null ? 0 : score) * 1.8 - 90) + 'deg)';
}
const MINIS = [
  { id: 'news', label: 'اخبار و دیپلماسی', from: ['news'] },
  { id: 'air', label: 'آسمان و پرواز', from: ['airspace', 'flights'] },
  { id: 'mil', label: 'نیروی نظامی', from: ['military'] },
  { id: 'emb', label: 'سفارتخانه‌ها', from: ['embassy'] },
  { id: 'net', label: 'اینترنت', from: ['internet'] },
];
function buildGauges() {
  $('mainGauge').innerHTML = gaugeSVG('gMain', 240, 136, 120, 124, 104, 28, 92, true);
  $('minis').innerHTML = MINIS.map(m => '<div class="mini-g">' + gaugeSVG('g_' + m.id, 120, 70, 60, 62, 50, 13, 42, false) +
    '<div class="n" id="n_' + m.id + '">—</div><div class="l">' + m.label + '</div></div>').join('');
}
const TIER_FA = { A: 'A', B: 'B', C: 'C' };

function render() {
  $('modeChip').className = 'chip ' + (settings.demo ? 'demo' : 'live');
  $('modeChip').textContent = settings.demo ? 'حالت آزمایشی' : 'زنده';
  $('demoPanel').style.display = settings.demo ? '' : 'none';
  const r = S.result;
  if (r) {
    $('scoreNum').textContent = fa(r.final);
    $('lvlName').textContent = r.level.name;
    document.documentElement.style.setProperty('--lvl', LVL_COLOR[r.level.key]);
    setGauge('gMain', r.final);
    MINIS.forEach(m => {
      const vals = r.indicators.filter(i => m.from.includes(i.id) && i.available).map(i => i.risk);
      const v = vals.length ? Math.max.apply(null, vals) : null;
      setGauge('g_' + m.id, v);
      $('n_' + m.id).textContent = v == null ? '—' : fa(Math.round(v));
    });
    $('updated').textContent = 'آخرین بررسی: ' + new Date(S.lastCheck).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    const ref = history.find(h => S.lastCheck - h.t <= 3 * HOUR && S.lastCheck - h.t >= 20 * MIN);
    const d = ref ? r.final - ref.s : 0;
    $('trend').textContent = !ref ? '' : d >= 3 ? '↑ رو به بدتر شدن' : d <= -3 ? '↓ رو به بهتر شدن' : '→ ثابت';
    $('trend').style.color = d >= 3 ? '#ff8a8a' : d <= -3 ? '#7dffb0' : '';
  }
  // اگر اپ هیچ خبری نمی‌تواند بخواند، باید صریح بگوید
  const act = E.SOURCES.filter(x => settings.sources[x.id] !== false);
  const blind = !settings.demo && S.lastCheck && act.length && act.every(x => S.health[x.id] && S.health[x.id].state === 'bad');
  $('blind').className = 'blind' + (blind ? ' on' : '');
  // آماده‌باش خانواده
  const rb = $('readyBox');
  if (S.ready.level === 'ready') {
    rb.className = 'ready on';
    rb.innerHTML = '<b>آماده‌باش خانواده:</b> ' + esc(S.ready.why) + '.<br>هنوز حمله‌ای تأیید نشده، اما وقت آماده شدن است: مدارک، شارژ گوشی، آب و غذا، پول نقد، باک پر، محل قرار.';
  } else rb.className = 'ready';
  // وضعیت آلارم
  const a = S.alert, st = $('alarmState');
  st.className = 'alarmstate ' + (a.level === 'none' ? '' : a.level);
  $('alarmText').textContent = a.level === 'full' ? 'آلارم کامل: حمله از دو منبع مستقل تأیید شده.' :
    a.level === 'standby' ? 'آماده‌باش: یک منبع معتبر با متن کامل خبر حمله داده، منتظر منبع دوم.' :
    'آلارم آماده است. خبر حمله‌ای تأیید نشده.';

  // اخبار مهم جنگی (رده A تا C، تازه‌ترین بالا)
  const key = (S.result ? S.result.effective : []).filter(e => e.tier === 'A' || e.tier === 'B' || e.tier === 'C').filter(e => e.pts > 0)
    .sort((x, y) => (x.tier === y.tier ? y.ts - x.ts : x.tier < y.tier ? -1 : 1)).slice(0, 15);
  const vlist = S.verified.map(v => '<div class="item"><span class="tier X">حمله</span><div><b>' + esc(v.title) + '</b><span class="t">' + esc(v.source) + ' • ' + ago(v.ts) + ' • ' + (v.textLevel === 'full' ? 'متن کامل خوانده شد' : 'فقط خلاصه خبر') + '</span></div></div>').join('');
  $('keynews').innerHTML = vlist + (key.length ? key.map(e =>
    '<div class="item"><span class="tier ' + e.tier + '">' + TIER_FA[e.tier] + '</span><div><b>' + esc(e.label) + (e.hypo ? ' (تیتر شرطی، اثر کم)' : '') + '</b><span class="t">' + esc(e.source) + ' • ' + ago(e.ts) + ' — ' + esc(e.title) + '</span></div></div>').join('')
    : (vlist ? '' : '<div class="empty">نشانه مهمی دیده نشده. این‌جا فقط خبرهایی می‌آیند که یکی از نشانه‌های پیش از حمله را دارند.</div>'));

  // دلیل‌های امتیاز
  const ev = (S.result ? S.result.effective : []).filter(e => e.effect !== 0).sort((x, y) => y.ts - x.ts).slice(0, 25);
  $('reasons').innerHTML = ev.length ? ev.map(e => {
    const p = Math.round(e.pts * 10) / 10;
    return '<div class="item"><span class="pts ' + (p > 0 ? 'pos' : 'neg') + '">' + (p > 0 ? '+' : '') + fa(p) + '</span><div><b>' + esc(e.label) + '</b><span class="t">' + esc(e.source) + ' • ' + ago(e.ts) + ' — ' + esc(e.title) + '</span></div></div>';
  }).join('') : '<div class="empty">هنوز دلیلی ثبت نشده. «بررسی الان» را بزنید.</div>';
  $('rejected').innerHTML = S.rejected.length ? S.rejected.map(x => '<div class="item"><span class="pts rej">رد</span><div><b>' + esc(x.title) + '</b><span class="t">' + esc(x.source) + ' — ' + esc(x.reason) + '</span></div></div>').join('') : '<div class="empty">خبری رد نشده. تیترهای شرطی و زرد اینجا با دلیل نمایش داده می‌شوند.</div>';

  // نشانگرها
  $('inds').innerHTML = (S.result ? S.result.indicators : E.INDICATORS.map(i => ({ name: i.name, weight: i.weight, risk: null, available: false, note: '' })))
    .map(i => '<div class="ind ' + (i.available ? '' : 'off') + '"><div class="top"><span>' + esc(i.name) + '</span><em>' + (i.available ? fa(Math.round(i.risk)) + ' از ۱۰۰' : (i.note || 'بدون داده')) + ' • وزن ' + fa(i.weight) + '</em></div>' +
      (i.available ? '<div class="note">' + esc(i.note || '') + '</div><div class="mini"><i style="width:' + i.risk + '%;--bw:' + (100 / Math.max(i.risk, 1) * 100) + '%"></i></div>' : '<div class="note">' + esc(i.note || '') + '</div>') + '</div>').join('');

  // منابع
  const warn = (!settings.demo && !isNative) ? '<div class="empty" style="color:#ffd98a">این صفحه در مرورگر باز شده است. مرورگر به‌خاطر قفل امنیتی (CORS) اجازه خواندن سایت‌های خبری را نمی‌دهد و همه منابع «ناموفق» می‌شوند. این مشکل در نسخه APK نیست.</div>' : '';
  $('srcs').innerHTML = settings.demo ? '<div class="empty">در حالت آزمایشی به منابع واقعی وصل نمی‌شویم.</div>' : warn +
    E.SOURCES.map(s => { const h = S.health[s.id]; const off = settings.sources[s.id] === false;
      return '<div class="src"><span>' + esc(s.name) + '</span><span class="' + (off ? 'idle' : !h ? 'idle' : h.state === 'ok' ? 'ok' : 'bad') + '">' + (off ? 'خاموش' : !h ? 'بررسی نشده' : h.state === 'ok' ? 'سالم • ' + fa(h.count) + ' خبر' : 'ناموفق: ' + esc(h.err || '')) + '</span></div>'; }).join('');
}

/* ---------- تست اتصال ---------- */
async function runDiag() {
  const out = $('diagOut');
  const tests = [
    ['OpenSky (پرواز)', 'https://opensky-network.org/api/states/all?lamin=35&lomin=51&lamax=36&lomax=52'],
    ['Cloudflare', 'https://www.cloudflare.com/cdn-cgi/trace'],
    ['آپارات (داخلی)', 'https://www.aparat.com/'],
    ['ایرنا RSS (داخلی)', 'https://www.irna.ir/rss'],
    ['BBC فارسی RSS', 'https://feeds.bbci.co.uk/persian/rss.xml'],
    ['الجزیره RSS', 'https://www.aljazeera.com/xml/rss/all.xml'],
    ['Google News RSS', 'https://news.google.com/rss/search?q=Iran&hl=en-US&gl=US&ceid=US:en'],
  ];
  let html = '<div class="note">نسخه ۰٫۳ • اندروید: ' + (isNative ? 'بله' : 'خیر (مرورگر)') + ' • روش: ' + (nativeHttp() ? 'شبکه مستقیم اندروید' : 'fetch مرورگر') + '</div>';
  out.innerHTML = html;
  for (const [name, url] of tests) {
    out.innerHTML = html + '<div class="src"><span>' + name + '</span><span class="idle">در حال تست…</span></div>';
    let line;
    try { const t = await httpText(url, 10000); line = '<span class="ok">موفق • ' + fa(t.length) + ' بایت</span>'; }
    catch (e) { line = '<span class="bad">' + esc(shortErr(e)) + '</span>'; }
    html += '<div class="src"><span>' + name + '</span>' + line + '</div>';
  }
  out.innerHTML = html + '<div class="note" style="margin-top:8px">از این صفحه اسکرین‌شات بگیر و برای من بفرست.</div>';
}
$('btnDiag').onclick = () => { $('dlgDiag').showModal(); runDiag(); };
$('btnDiagClose').onclick = () => $('dlgDiag').close();

/* ---------- دمو ---------- */
function buildDemo() {
  const g = $('demoGrid'); g.innerHTML = '';
  Object.keys(D.SCENARIOS).forEach(k => {
    const b = document.createElement('button'); b.textContent = D.SCENARIOS[k].label;
    if (k === S.scenario) b.className = 'on';
    b.onclick = () => { S.scenario = k; acks = []; save('wr_acks', acks); hideAlarm(); buildDemo(); runCheck(); };
    g.appendChild(b);
  });
}

/* ---------- تنظیمات ---------- */
function openSettings() {
  $('setDemo').checked = settings.demo; $('setInt').value = settings.interval;
  $('weights').innerHTML = E.INDICATORS.filter(i => i.available).map(i => {
    const w = settings.weights[i.id] != null ? settings.weights[i.id] : i.weight;
    return '<div class="field"><label><span>' + esc(i.name) + '</span><b id="wv_' + i.id + '">' + fa(w) + '</b></label><input type="range" min="0" max="40" value="' + w + '" data-w="' + i.id + '"></div>';
  }).join('');
  $('weights').querySelectorAll('input').forEach(r => r.oninput = () => $('wv_' + r.dataset.w).textContent = fa(r.value));
  $('srcToggles').innerHTML = E.SOURCES.map(s => '<div class="sw"><span>' + esc(s.name) + '</span><input type="checkbox" data-s="' + s.id + '" ' + (settings.sources[s.id] === false ? '' : 'checked') + '></div>').join('');
  $('dlg').showModal();
}
$('btnSettings').onclick = openSettings;
$('btnClose').onclick = () => $('dlg').close();
$('btnSave').onclick = () => {
  settings.demo = $('setDemo').checked; settings.interval = Math.max(1, +$('setInt').value || 5);
  $('weights').querySelectorAll('input').forEach(r => settings.weights[r.dataset.w] = +r.value);
  $('srcToggles').querySelectorAll('input').forEach(c => settings.sources[c.dataset.s] = c.checked);
  save('wr_settings', settings); $('dlg').close(); S.health = {}; runCheck();
  try { if (!settings.demo && window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
};
$('btnReset').onclick = () => { settings = { demo: true, interval: 5, weights: {}, sources: {} }; save('wr_settings', settings); $('dlg').close(); runCheck(); };
$('btnCheck').onclick = () => { ensureCtx(); runCheck(); };
document.addEventListener('pointerdown', ensureCtx);
document.addEventListener('visibilitychange', () => { if (!document.hidden) runCheck(); });

buildGauges(); buildDemo(); render(); ensureCtx(); runCheck();
})();
