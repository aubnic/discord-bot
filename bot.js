const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = '1450816596036685894';

const STATS_FILE = 'daily_stats.json'; // Lagrer kumulativ statistikk for i dag

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

let lastMessageId = null;
const MESSAGE_FILE = 'last_message_id.txt';

try {
  if (fs.existsSync(MESSAGE_FILE)) {
    lastMessageId = fs.readFileSync(MESSAGE_FILE, 'utf8').trim();
  }
} catch (e) {}

client.once('ready', () => {
  console.log(`Bot logget inn som ${client.user.tag}`);
  setInterval(runReport, 60 * 1000);
  runReport();
});

async function runReport() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();

  const allowedTimes = [
    { hour: 9, minute: 0 },
    { hour: 14, minute: 20 },
    { hour: 16, minute: 20 },
  ];

  const shouldRun = allowedTimes.some(t => hour === t.hour && minute === t.minute);

  if (!shouldRun) return;

  console.log(`Kl. ${hour}:${minute} – Oppdaterer kumulativ rapport...`);

  const venues = [
    { name: 'Oslo Golf Lounge', slug: 'oslo-golf-lounge', daytimePrice: 350, primetimePrice: 450 },
    { name: 'Tee Time Rådhuset', slug: 'tee-time-radhuset', daytimePrice: 350, primetimePrice: 450 },
    { name: 'Oslo Golfsimulator', slug: 'oslo-golfsimulator', daytimePrice: 300, primetimePrice: 450 },
    { name: 'Golfshopen Bryn', slug: 'golfshopen-bryn', daytimePrice: 300, primetimePrice: 499 },
    { name: 'Golfshopen Skøyen', slug: 'golfshopen-skoyen', daytimePrice: 300, primetimePrice: 499 },
    { name: 'Grønmo Indoor Golf', slug: 'skullerud', daytimePrice: 300, primetimePrice: 400 },
    { name: 'Nittedal Indoor Golf', slug: 'nittedal-indoor-golf', daytimePrice: 300, primetimePrice: 400 },
    { name: 'Golfshopen Billingstad', slug: 'golfshopen-billingstad', daytimePrice: 300, primetimePrice: 499 },
    { name: 'Golfland (Oslo GK)', slug: 'golfland', daytimePrice: 395, primetimePrice: 495 },
  ];

  const today = now.toISOString().slice(0, 10);

  // Last inn eksisterende kumulativ statistikk (eller start ny)
  let cumulativeStats = {};
  if (fs.existsSync(STATS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
      if (data.date === today) cumulativeStats = data.stats;
    } catch (e) {}
  }

  // Initialiser hvis ny dag
  if (Object.keys(cumulativeStats).length === 0) {
    venues.forEach(v => {
      cumulativeStats[v.slug] = { dayO: 0, dayT: 0, primeO: 0, primeT: 0, income: 0, sims: 1 };
    });
  }

  // Hent fersk data fra API
  for (const v of venues) {
    const stats = cumulativeStats[v.slug] || { dayO: 0, dayT: 0, primeO: 0, primeT: 0, income: 0, sims: 1 };

    try {
      const res = await fetch('https://albaplay.com/api/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-client-version': 'dff938ea09b01fbfd186702458b40d1980e07c36' },
        body: JSON.stringify({
          operationName: 'GetLocationCalendarHookExplicitV2',
          variables: { slug: v.slug, date: today, resourceType: 'SIM' },
          query: `query GetLocationCalendarHookExplicitV2($slug: String!, $date: String!, $resourceType: ResourceType!) {
            locationBySlugForCalendar(slug: $slug, date: $date, resourceType: $resourceType) {
              locationCalendar { resourceWithCalendar { name slots { startTime availability { state } } } }
            }
          }`
        })
      });

      const json = await res.json();
      if (!json.data?.locationBySlugForCalendar?.locationCalendar) continue;

      const resources = json.data.locationBySlugForCalendar.locationCalendar.resourceWithCalendar || [];
      stats.sims = Math.max(stats.sims, resources.length);

      resources.forEach(r => r.slots.forEach(slot => {
        const h = parseInt(slot.startTime.split('T')[1].split(':')[0]);
        const prime = h >= 16;
        const o = slot.availability.state !== 'AVAILABLE';

        if (prime) {
          stats.primeT = Math.max(stats.primeT, stats.primeT + 1); // Total slots øker ikke, men vi teller opptatt
          if (o && stats.primeO < stats.primeT) stats.primeO++; // Kun øk opptatt hvis ny booket
          if (o) stats.income = Math.max(stats.income, stats.income + v.primetimePrice);
        } else {
          stats.dayT = Math.max(stats.dayT, stats.dayT + 1);
          if (o && stats.dayO < stats.dayT) stats.dayO++;
          if (o) stats.income = Math.max(stats.income, stats.income + v.daytimePrice);
        }
      }));
    } catch (e) {}

    cumulativeStats[v.slug] = stats;
  }

  // Lagre kumulativ statistikk for neste kjøring
  fs.writeFileSync(STATS_FILE, JSON.stringify({ date: today, stats: cumulativeStats }));

  const results = venues.map(v => {
    const s = cumulativeStats[v.slug];
    const dayPct = s.dayT ? Math.round(s.dayO / s.dayT * 100) : 0;
    const primePct = s.primeT ? Math.round(s.primeO / s.primeT * 100) : 0;
    const incomePerSim = s.sims ? Math.round(s.income / s.sims) : 0;

    return {
      name: v.name,
      day: `${s.dayO}/${s.dayT} (${dayPct}%)`,
      prime: `${s.primeO}/${s.primeT} (${primePct}%)`,
      income: incomePerSim,
      primePct
    };
  });

  results.sort((a, b) => b.primePct - a.primePct);

  const timeStr = now.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });

  let message = `**🏌️ Golfsimulator-trykk Oslo** – ${now.toLocaleDateString('nb-NO')} (oppdatert kl. ${timeStr})\n*Kumulativ – alle bookinger telt*\n\n`;

  results.forEach(r => {
    const dayBar = '█'.repeat(Math.floor(parseInt(r.day.split('(')[1]) / 10)) + '░'.repeat(10 - Math.floor(parseInt(r.day.split('(')[1]) / 10));
    const primeBar = '█'.repeat(Math.floor(r.primePct / 10)) + '░'.repeat(10 - Math.floor(r.primePct / 10));

    message += `**${r.name}**\n` +
      `Dag: ${r.day} ${dayBar}\n` +
      `Prime: ${r.prime} ${primeBar}\n` +
      `~${r.income.toLocaleString('nb-NO')} kr/sim\n\n`;
  });

  const channel = await client.channels.fetch(CHANNEL_ID);

  // Ny dag? Ny melding
  const currentDate = now.toISOString().slice(0, 10);
  if (!lastMessageId || currentDate !== (fs.existsSync('current_date.txt') ? fs.readFileSync('current_date.txt', 'utf8').trim() : '')) {
    const newMsg = await channel.send(message);
    lastMessageId = newMsg.id;
    fs.writeFileSync(MESSAGE_FILE, lastMessageId);
    fs.writeFileSync('current_date.txt', currentDate);
  } else {
    try {
      const msg = await channel.messages.fetch(lastMessageId);
      await msg.edit(message);
    } catch (e) {
      const newMsg = await channel.send(message);
      lastMessageId = newMsg.id;
      fs.writeFileSync(MESSAGE_FILE, lastMessageId);
    }
  }
}

client.login(TOKEN);
