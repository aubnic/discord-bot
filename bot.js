const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = '1450816596036685894';

const MESSAGE_ID_FILE = 'current_message_id.txt'; // Husker ID for dagens melding
const DATE_FILE = 'current_date.txt'; // Husker dagens dato

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

let currentMessageId = null;
let currentDate = null;

try {
  if (fs.existsSync(MESSAGE_ID_FILE)) currentMessageId = fs.readFileSync(MESSAGE_ID_FILE, 'utf8').trim();
  if (fs.existsSync(DATE_FILE)) currentDate = fs.readFileSync(DATE_FILE, 'utf8').trim();
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
  const todayStr = now.toISOString().slice(0, 10);

  const allowedTimes = [
    { hour: 9, minute: 0 },
    { hour: 14, minute: 20 },
    { hour: 16, minute: 20 },
  ];

  const shouldRun = allowedTimes.some(t => hour === t.hour && minute === t.minute);

  if (!shouldRun) return;

  console.log(`Kl. ${hour}:${minute} – Oppdaterer rapport for ${todayStr}...`);

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

  let message = `**🏌️ Golfsimulator-trykk Oslo** – ${now.toLocaleDateString('nb-NO')} (oppdatert kl. ${timeStr})\n*Sortert etter primetime-belastning*\n\n`;

  results.forEach(r => {
    const dayBar = '█'.repeat(Math.floor(parseInt(r.day.split('(')[1]) / 10)) + '░'.repeat(10 - Math.floor(parseInt(r.day.split('(')[1]) / 10));
    const primeBar = '█'.repeat(Math.floor(r.primePct / 10)) + '░'.repeat(10 - Math.floor(r.primePct / 10));

    message += `**${r.name}**\n` +
      `Dag: ${r.day} ${dayBar}\n` +
      `Prime: ${r.prime} ${primeBar}\n` +
      `~${r.income.toLocaleString('nb-NO')} kr/sim\n\n`;
  });

  const channel = await client.channels.fetch(CHANNEL_ID);

  // Sjekk om det er ny dag
  if (currentDate !== todayStr || !currentMessageId) {
    // Ny dag – send ny melding
    const newMsg = await channel.send(message);
    currentMessageId = newMsg.id;
    currentDate = todayStr;
    fs.writeFileSync(MESSAGE_ID_FILE, currentMessageId);
    fs.writeFileSync(DATE_FILE, currentDate);
    console.log('Ny melding for ny dag sendt!');
  } else {
    // Samme dag – oppdater eksisterende melding
    try {
      const msg = await channel.messages.fetch(currentMessageId);
      await msg.edit(message);
      console.log('Dagens melding oppdatert!');
    } catch (e) {
      // Hvis meldingen er slettet – send ny
      const newMsg = await channel.send(message);
      currentMessageId = newMsg.id;
      fs.writeFileSync(MESSAGE_ID_FILE, currentMessageId);
      console.log('Ny melding sendt (gammel slettet)');
    }
  }
}

client.login(TOKEN);
