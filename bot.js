const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = 'DIN_KANAL_ID_HER';

const MESSAGE_FILE = 'last_message_id.txt';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

let lastMessageId = null;

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

  console.log(`Kl. ${hour}:${minute} – Genererer rapport...`);

  const venues = [
    { name: 'Oslo Golf Lounge', slug: 'oslo-golf-lounge', daytimePrice: 350, primetimePrice: 450 },
    { name: 'Tee Time Rådhuset', slug: 'tee-time-radhuset', daytimePrice: 350, primetimePrice: 450 },
    { name: 'Oslo Golfsimulator (Pilestredet)', slug: 'oslo-golfsimulator', daytimePrice: 300, primetimePrice: 450 },
    { name: 'Golfshopen Bryn', slug: 'golfshopen-bryn', daytimePrice: 300, primetimePrice: 499 },
    { name: 'Golfshopen Skøyen', slug: 'golfshopen-skoyen', daytimePrice: 300, primetimePrice: 499 },
    { name: 'Grønmo Indoor Golf', slug: 'skullerud', daytimePrice: 300, primetimePrice: 400 },
    { name: 'Nittedal Indoor Golf', slug: 'nittedal-indoor-golf', daytimePrice: 300, primetimePrice: 400 },
    { name: 'Golfshopen Billingstad', slug: 'golfshopen-billingstad', daytimePrice: 300, primetimePrice: 499 },
    { name: 'Golfland (Oslo GK)', slug: 'golfland', daytimePrice: 395, primetimePrice: 495 },
  ];

  const today = now.toISOString().slice(0, 10);

    // Liste over datoer hvor de fleste simulatorer er stengt (YYYY-MM-DD)
  const closedDates = [
    '2025-12-24', // Julaften (ofte stengt eller redusert)
    '2025-12-25', // 1. juledag
    '2025-12-26', // 2. juledag
    '2026-01-01', // Nyttårsdag
    '2025-12-31', // Nyttårsaften (ofte stengt etter kl. 16)
  ];

  const isClosedDay = closedDates.includes(today);

  if (isClosedDay) {
    message += `⚠️ **Merk:** De fleste simulatorer er stengt eller har redusert åpningstid i dag (helligdag).\n\n`;
  }

  const results = [];

  for (const v of venues) {
    const stats = { dayT: 0, dayO: 0, primeT: 0, primeO: 0, income: 0, sims: 1 };

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

        if (prime) { stats.primeT++; if (o) { stats.primeO++; stats.income += v.primetimePrice; } }
        else { stats.dayT++; if (o) { stats.dayO++; stats.income += v.daytimePrice; } }
      }));
    } catch (e) {}

    const dayPct = stats.dayT ? Math.round(stats.dayO / stats.dayT * 100) : 0;
    const primePct = stats.primeT ? Math.round(stats.primeO / stats.primeT * 100) : 0;
    const incomePerSim = stats.sims ? Math.round(stats.income / stats.sims) : 0;

    results.push({
      name: v.name,
      day: `${stats.dayO}/${stats.dayT} (${dayPct}%)`,
      prime: `${stats.primeO}/${stats.primeT} (${primePct}%)`,
      income: incomePerSim,
      primePct
    });
  }

  results.sort((a, b) => b.primePct - a.primePct);

  const timeStr = now.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });

  let message = `**🏌️ Golfsimulator-trykk Oslo** – ${now.toLocaleDateString('nb-NO')} kl. ${timeStr}\n*Sortert etter primetime-belastning i dag*\n\n`;

  results.forEach(r => {
    const dayBar = '█'.repeat(Math.floor(parseInt(r.day.split('(')[1]) / 5)) + '░'.repeat(20 - Math.floor(parseInt(r.day.split('(')[1]) / 5));
    const primeBar = '█'.repeat(Math.floor(r.primePct / 5)) + '░'.repeat(20 - Math.floor(r.primePct / 5));

    message += `${r.name}\n` +
      `🌅 Dag (<16:00): ${r.day} ${dayBar}\n` +
      `🌙 Prime (≥16:00): ${r.prime} ${primeBar}\n` +
      `💰 ~${r.income.toLocaleString('nb-NO')} kr/sim\n\n`;
  });

  const channel = await client.channels.fetch(CHANNEL_ID);

  if (lastMessageId) {
    try {
      const msg = await channel.messages.fetch(lastMessageId);
      await msg.edit(message);
      console.log('Rapport oppdatert!');
      return;
    } catch (e) {
      console.log('Kunne ikke redigere – sender ny');
    }
  }

  const newMsg = await channel.send(message);
  lastMessageId = newMsg.id;
  fs.writeFileSync(MESSAGE_FILE, lastMessageId);
  console.log('Ny rapport sendt!');
}

client.login(TOKEN);
