const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const fs = require('fs');

const TOKEN = 'MTQ1MTE0OTY5MzcyMjgyMDY3Mg.Gfav_Y.pB2IAI8-qVBRqcRaDT_Dk3Y11EEgzORSnXDHz0'; // Erstatt med din bot-token
const CHANNEL_ID = '1450816596036685894'; // ID-en til kanalen rapporten skal i (høyreklikk kanal → Copy ID)
const MESSAGE_FILE = 'last_message_id.txt'; // Fil for å lagre ID-en til meldingen vi oppdaterer

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

let lastMessageId = null;

// Les gammel message ID ved start (hvis finnes)
try {
  if (fs.existsSync(MESSAGE_FILE)) {
    lastMessageId = fs.readFileSync(MESSAGE_FILE, 'utf8').trim();
  }
} catch (e) {}

client.once('ready', () => {
  console.log(`Bot logget inn som ${client.user.tag}`);
  setInterval(runReport, 60 * 1000); // Sjekk hvert minutt
  runReport(); // Kjør med en gang ved start
});

async function runReport() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();

  // Kjør kun på 09:00, 14:20 og 16:20
  const allowedTimes = [
    { hour: 9, minute: 0 },
    { hour: 14, minute: 20 },
    { hour: 16, minute: 20 },
  ];

  const shouldRun = allowedTimes.some(t => hour === t.hour && minute === t.minute);

  if (!shouldRun) return;

  console.log(`Kl. ${hour}:${minute} – Genererer rapport...`);

  // Din tracker-logikk (hent data, beregn statistikk)
  const venues = [
    { name: 'Oslo Golf Lounge', slug: 'oslo-golf-lounge', daytimePrice: 350, primetimePrice: 450 },
    { name: 'Tee Time Rådhuset', slug: 'tee-time-radhuset', daytimePrice: 350, primetimePrice: 450 },
    { name: 'Oslo Golfsimulator', slug: 'oslo-golfsimulator', daytimePrice: 300, primetimePrice: 450 },
    { name: 'Golfshopen Bryn', slug: 'golfshopen-bryn', daytimePrice: 300, primetimePrice: 499 },
    { name: 'Golfshopen Skøyen', slug: 'golfshopen-skoyen', daytimePrice: 300, primetimePrice: 499 },
    { name: 'Grønmo Indoor Golf', slug: 'skullerud', daytimePrice: 300, primetimePrice: 400 },
    { name: 'Nittedal Indoor Golf', slug: 'nittedal-indoor-golf', daytimePrice: 300, primetimePrice: 400 },
    { name: 'Briskeby Golf', slug: 'briskeby-golf', daytimePrice: 350, primetimePrice: 500 },
    { name: 'Golfshopen Billingstad', slug: 'golfshopen-billingstad', daytimePrice: 300, primetimePrice: 499 },
    { name: 'Golfland (Oslo GK)', slug: 'golfland', daytimePrice: 395, primetimePrice: 495 },
  ];

  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const results = [];

  for (const v of venues) {
    const todayStats = { dayT: 0, dayO: 0, primeT: 0, primeO: 0, income: 0, sims: 1 };
    const tomorrowStats = { dayT: 0, dayO: 0, primeT: 0, primeO: 0, income: 0, sims: 1 };

    for (const [date, stats] of [[today, todayStats], [tomorrow, tomorrowStats]]) {
      try {
        const res = await fetch('https://albaplay.com/api/graphql', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-client-version': 'dff938ea09b01fbfd186702458b40d1980e07c36' },
          body: JSON.stringify({
            operationName: 'GetLocationCalendarHookExplicitV2',
            variables: { slug: v.slug, date, resourceType: 'SIM' },
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
    }

    const todayDayPct = todayStats.dayT ? Math.round(todayStats.dayO / todayStats.dayT * 100) : 0;
    const todayPrimePct = todayStats.primeT ? Math.round(todayStats.primeO / todayStats.primeT * 100) : 0;
    const todayIncome = todayStats.sims ? Math.round(todayStats.income / todayStats.sims) : 0;

    const tomorrowDayPct = tomorrowStats.dayT ? Math.round(tomorrowStats.dayO / tomorrowStats.dayT * 100) : 0;
    const tomorrowPrimePct = tomorrowStats.primeT ? Math.round(tomorrowStats.primeO / tomorrowStats.primeT * 100) : 0;
    const tomorrowIncome = tomorrowStats.sims ? Math.round(tomorrowStats.income / tomorrowStats.sims) : 0;

    results.push({
      name: v.name,
      todayDay: `${todayStats.dayO}/${todayStats.dayT} (${todayDayPct}%)`,
      todayPrime: `${todayStats.primeO}/${todayStats.primeT} (${todayPrimePct}%)`,
      todayIncome,
      tomorrowDay: `${tomorrowStats.dayO}/${tomorrowStats.dayT} (${tomorrowDayPct}%)`,
      tomorrowPrime: `${tomorrowStats.primeO}/${tomorrowStats.primeT} (${tomorrowPrimePct}%)`,
      tomorrowIncome,
    });
  }

  results.sort((a, b) => {
    const aPrime = parseInt(a.todayPrime.split('(')[1]);
    const bPrime = parseInt(b.todayPrime.split('(')[1]);
    return bPrime - aPrime;
  });

  const timeStr = now.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });

  let message = `Golfsimulator-trykk Oslo – ${now.toLocaleDateString('nb-NO')} kl. ${timeStr} 📊\nSortert etter primetime i dag\n\n`;

  results.forEach(r => {
    const barTodayDay = '█'.repeat(Math.floor(parseInt(r.todayDay.split('(')[1]) / 5)) + '░'.repeat(20 - Math.floor(parseInt(r.todayDay.split('(')[1]) / 5));
    const barTodayPrime = '█'.repeat(Math.floor(parseInt(r.todayPrime.split('(')[1]) / 5)) + '░'.repeat(20 - Math.floor(parseInt(r.todayPrime.split('(')[1]) / 5));
    const barTomorrowDay = '█'.repeat(Math.floor(parseInt(r.tomorrowDay.split('(')[1]) / 5)) + '░'.repeat(20 - Math.floor(parseInt(r.tomorrowDay.split('(')[1]) / 5));
    const barTomorrowPrime = '█'.repeat(Math.floor(parseInt(r.tomorrowPrime.split('(')[1]) / 5)) + '░'.repeat(20 - Math.floor(parseInt(r.tomorrowPrime.split('(')[1]) / 5));

    message += `${r.name}\n` +
      `I dag Dag: ${r.todayDay} ${barTodayDay}\n` +
      `I dag Prime: ${r.todayPrime} ${barTodayPrime}\n` +
      `~${r.todayIncome.toLocaleString('nb-NO')} kr/sim (i dag)\n\n` +
      `I morgen Dag: ${r.tomorrowDay} ${barTomorrowDay}\n` +
      `I morgen Prime: ${r.tomorrowPrime} ${barTomorrowPrime}\n` +
      `~${r.tomorrowIncome.toLocaleString('nb-NO')} kr/sim (i morgen)\n\n`;
  });

  // Send eller oppdater meldingen
  const channel = await client.channels.fetch(CHANNEL_ID);

  if (lastMessageId) {
    try {
      const msg = await channel.messages.fetch(lastMessageId);
      await msg.edit(message);
      console.log('Rapport oppdatert!');
      return;
    } catch (e) {
      console.log('Kunne ikke redigere – sender ny melding');
    }
  }

  // Send ny melding hvis ingen gammel
  const newMsg = await channel.send(message);
  lastMessageId = newMsg.id;
  fs.writeFileSync(MESSAGE_FILE, lastMessageId);
  console.log('Ny rapport sendt!');
}

client.login(TOKEN);