/* سناریوهای آزمایشی — برای دیدن رفتار اپ بدون نیاز به خبر واقعی */
(function (root) {
'use strict';
const M = 60e3;
function mk(source, group, title, body, minsAgo, now) {
  return { source, group, title, body, link: 'demo://' + group + '/' + encodeURIComponent(title).slice(0, 40),
    ts: now - minsAgo * M, fullText: true };
}
const SCENARIOS = {
  calm: {
    label: 'آرام',
    internet: { risk: 15, note: 'اینترنت عادی' }, flights: { risk: 20, note: 'ترافیک عادی' },
    items: n => [
      mk('رویترز','reuters','Iran and European powers agree to hold new talks','Diplomats said talks on the nuclear file would resume next month. Negotiators described the atmosphere as constructive and flights across the region are operating normally.',90,n),
      mk('BBC فارسی','bbc','از سرگیری پروازها در حریم هوایی منطقه','شرکت‌های هواپیمایی پروازهای خود را از سر گرفتند و حریم هوایی بازگشایی شد.',200,n),
    ],
  },
  tension: {
    label: 'تنش بالا می‌رود',
    internet: { risk: 15, note: 'اینترنت عادی' }, flights: { risk: 40, note: 'ترافیک کمی کمتر از عادی' },
    items: n => [
      mk('رویترز','reuters','US sends aircraft carrier to the Gulf as tensions with Iran escalate','The Pentagon said it deployed a carrier strike group. Officials warned of further escalation.',50,n),
      mk('الجزیره','aljazeera','US embassies in the region face new pressure as tensions rise','The State Department issued a level 4 travel advisory urging citizens not to travel to Iran or Iraq.',70,n),
      mk('AP','ap','Airlines cancel flights and divert routes as airspace restrictions expand','Several airlines suspended flights while Iraq closed its airspace temporarily.',35,n),
      mk('BBC فارسی','bbc','جلسه اضطراری شورای امنیت درباره تنش‌ها','شورای امنیت به صورت اضطراری تشکیل جلسه داد.',25,n),
    ],
  },
  ready: {
    label: 'شب قبل از حمله (آماده‌باش)',
    internet: { risk: 15, note: 'اینترنت عادی' }, flights: { risk: 70, note: 'ترافیک بسیار کمتر از عادی' },
    items: n => [
      mk('رویترز','reuters','US embassy orders departure of non-emergency staff, ambassador tells staff to leave today','The State Department ordered departure of non-emergency embassy personnel and their families. Staff wishing to leave should do so today while commercial flights remain available.',120,n),
      mk('الجزیره','aljazeera','Airlines suspend flights to Tehran as US military buildup nears completion','Several airlines cancelled flights and Turkish carriers suspended service. Officials said the buildup was nearing completion.',90,n),
      mk('AP','ap','Russia evacuates specialists from Bushehr as tensions peak','Rosatom said it was evacuating staff from Iran. Moscow urged all sides to avoid targeting nuclear sites.',60,n),
    ],
  },
  clickbait: {
    label: 'تیتر زرد (باید رد شود)',
    internet: { risk: 15, note: 'اینترنت عادی' }, flights: { risk: 20, note: 'ترافیک عادی' },
    items: n => [
      mk('سایت زرد','yellow','اگر جنگ شروع شد، این اتفاق در تهران می‌افتد! کلیک کنید','اگر جنگ شروع شود ممکن است حمله به تهران رخ دهد و انفجار در تهران محتمل است. کارشناسان هشدار می‌دهند.',10,n),
      mk('Tabloid','tabloid','What happens if the US strikes Tehran? Experts warn','If the US bombed Tehran, explosions could hit the city. Analysts warn this scenario is possible.',12,n),
      mk('رویترز','reuters','Iran holds air defence drill near Isfahan','Iran held an annual air defence exercise in Isfahan province on Tuesday. The drill was planned months ago.',30,n),
    ],
  },
  single: {
    label: 'خبر حمله از یک منبع',
    internet: { risk: 15, note: 'اینترنت عادی' }, flights: { risk: 40, note: 'کمی کمتر از عادی' },
    items: n => [
      mk('رویترز','reuters','Explosions heard in Tehran, witnesses report air strikes','Witnesses told Reuters that explosions struck several districts of Tehran on Saturday. Air strikes hit sites in the capital, residents said.',4,n),
    ],
  },
  confirmed: {
    label: 'تأیید دو منبع (آلارم کامل)',
    internet: { risk: 70, note: 'هم سایت داخلی و هم خارجی باز نشد' }, flights: { risk: 92, note: 'آسمان تقریباً خالی است' },
    items: n => [
      mk('رویترز','reuters','Explosions heard in Tehran, witnesses report air strikes','Witnesses told Reuters that explosions struck several districts of Tehran on Saturday. Air strikes hit sites in the capital, residents said.',6,n),
      mk('BBC فارسی','bbc','انفجار در چند نقطه تهران؛ شاهدان از حمله هوایی خبر می‌دهند','ساعاتی پیش صدای انفجار در تهران شنیده شد. شاهدان می‌گویند حمله هوایی چند نقطه شهر را هدف قرار داد.',3,n),
    ],
  },
};
const api = { SCENARIOS };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.DemoData = api;
})(typeof window !== 'undefined' ? window : globalThis);
