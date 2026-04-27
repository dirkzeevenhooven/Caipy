// Caipy — Cape Town Itinerary Chatbot Backend
// Node.js + Express + Stripe + Claude API

require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Session store (use Redis/DB in production) ───────────────────────────────
// Maps accessToken → { email, createdAt }
const sessions = new Map();

// Maps pendingId → { itinerary, createdAt } — temporary pre-payment itinerary store
const pendingItineraries = new Map();

// Clean up pending itineraries older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, val] of pendingItineraries) {
    if (val.createdAt < cutoff) pendingItineraries.delete(id);
  }
}, 30 * 60 * 1000);

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isValidToken(token) {
  if (!sessions.has(token)) return false;
  const { createdAt } = sessions.get(token);
  // Tokens valid for 30 days
  return Date.now() - createdAt < 30 * 24 * 60 * 60 * 1000;
}

// ─── PDF Generator ───────────────────────────────────────────────────────────
function stripMd(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`(.+?)`/g, '$1');
}

async function generateItineraryPDF(itinerary) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const navy = '#1C1C1A';
    const gold = '#B8863A';
    const muted = '#6B6560';
    const W = doc.page.width - 120;

    // ── Header ──
    doc.rect(0, 0, doc.page.width, 72).fill(navy);
    doc.fillColor(gold).fontSize(22).font('Times-Roman')
       .text('The Cape Town Guide', 60, 20, { width: W, lineBreak: false });
    doc.fillColor('white').fontSize(8).font('Helvetica')
       .text('PLANET UNCHARTED  ·  TRAVELGUIDE', 60, 50, { width: W, lineBreak: false });

    // ── Title block ──
    doc.rect(60, 88, W, 1.5).fill(gold);
    doc.fillColor(navy).fontSize(26).font('Times-Roman')
       .text('Your Cape Town Itinerary', 60, 100, { width: W });
    doc.fillColor(muted).fontSize(9).font('Helvetica')
       .text('CURATED BY CAIPY  ·  DIRK\'S LOCAL KNOWLEDGE', { width: W, characterSpacing: 1 });
    doc.moveDown(0.6);
    doc.rect(60, doc.y, W, 1).fill(gold);
    doc.moveDown(1.5);

    // ── Body ──
    for (const line of itinerary.split('\n')) {
      const t = line.trim();
      if (!t) { doc.moveDown(0.4); continue; }

      if (t.startsWith('# ')) {
        doc.moveDown(0.5);
        doc.fillColor(navy).fontSize(18).font('Times-Roman').text(t.slice(2), { width: W });
        doc.moveDown(0.2);
      } else if (t.startsWith('## ')) {
        doc.moveDown(0.4);
        doc.fillColor(gold).fontSize(14).font('Times-Roman').text(t.slice(3), { width: W });
        doc.moveDown(0.2);
      } else if (t.startsWith('### ')) {
        doc.moveDown(0.2);
        doc.fillColor(navy).fontSize(11).font('Helvetica-Bold').text(t.slice(4), { width: W });
        doc.moveDown(0.1);
      } else if (t.startsWith('- ') || t.startsWith('* ')) {
        doc.fillColor(navy).fontSize(10).font('Helvetica')
           .text('• ' + stripMd(t.slice(2)), { width: W - 15, indent: 15 });
      } else {
        doc.fillColor(navy).fontSize(10).font('Helvetica').text(stripMd(t), { width: W });
      }
    }

    // ── Footer ──
    doc.moveDown(2);
    doc.rect(60, doc.y, W, 1).fill(gold);
    doc.moveDown(0.6);
    doc.fillColor(muted).fontSize(8).font('Helvetica')
       .text('The Cape Town Guide  ·  thecapetownguide.com  ·  Powered by Caipy', { width: W, align: 'center' });
    doc.text('10+ years of Cape Town local knowledge, curated by Dirk Zeevenhooven', { width: W, align: 'center' });

    doc.end();
  });
}

// ─── Guide HTML helpers ──────────────────────────────────────────────────────

// Simple markdown → HTML for day card bodies
function mdToHtml(text) {
  const lines = text.split('\n');
  const out = [];
  let inUl = false;
  const timeIcons = { morning: '☀️', afternoon: '🌤️', evening: '🌙', night: '🌙', lunch: '🍽️', dinner: '🍽️', breakfast: '☕' };

  for (const raw of lines) {
    const safe = raw
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
    if (/^#{1,4}\s/.test(raw)) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      const heading = safe.replace(/^#{1,4}\s+/, '');
      const key = Object.keys(timeIcons).find(k => heading.toLowerCase().startsWith(k));
      const icon = key ? `<span class="tod-icon">${timeIcons[key]}</span>` : '';
      const cls = key ? ` class="tod-heading tod-${key}"` : '';
      out.push(`<h4${cls}>${icon}${heading}</h4>`);
    } else if (/^[-*]\s/.test(raw)) {
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${safe.replace(/^[-*]\s/, '')}</li>`);
    } else if (raw.trim() === '') {
      if (inUl) { out.push('</ul>'); inUl = false; }
    } else {
      if (inUl) { out.push('</ul>'); inUl = false; }
      out.push(`<p>${safe}</p>`);
    }
  }
  if (inUl) out.push('</ul>');
  return out.join('');
}

// Convert itinerary markdown → accordion day cards HTML
function itineraryToDayCards(itinerary) {
  const days = [];
  let current = null;
  for (const line of itinerary.split('\n')) {
    const m = line.match(/^##\s+Day\s+(\d+)[:\s—–-]*(.+)?/i);
    if (m) {
      if (current) days.push(current);
      current = { num: m[1], title: (m[2] || `Day ${m[1]}`).trim(), lines: [] };
    } else if (current) {
      if (/^#{1,2}\s+(A Note|Note from)/i.test(line) || /^#\s/.test(line)) {
        days.push(current); current = null;
      } else {
        current.lines.push(line);
      }
    }
  }
  if (current) days.push(current);

  if (days.length === 0) {
    return `<div class="day-card fade-in">
      <div class="day-card-header">
        <div class="day-number">1</div>
        <div class="day-title-wrap">
          <div class="day-label">Your Itinerary</div>
          <div class="day-title">Cape Town Adventure</div>
        </div>
        <div class="day-toggle"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></div>
      </div>
      <div class="day-card-body"><div class="day-content">${mdToHtml(itinerary)}</div></div>
    </div>`;
  }

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return days.map(day => `
    <div class="day-card fade-in">
      <div class="day-card-header">
        <div class="day-number">${day.num}</div>
        <div class="day-title-wrap">
          <div class="day-label">Day ${day.num}</div>
          <div class="day-title">${esc(day.title)}</div>
        </div>
        <div class="day-toggle"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></div>
      </div>
      <div class="day-card-body"><div class="day-content">${mdToHtml(day.lines.join('\n'))}</div></div>
    </div>`).join('\n');
}

// Fill template placeholders and save to public/guides/[id].html
async function generateAndSaveGuide(itinerary, tripData, guideId) {
  const templatePath = path.join(__dirname, 'guide-template.html');
  if (!fs.existsSync(templatePath)) {
    console.error('Guide template not found:', templatePath);
    return null;
  }
  const template = fs.readFileSync(templatePath, 'utf8');
  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = template
    .replace(/\{\{CUSTOMER_NAME\}\}/g, esc(tripData.customerName || 'Traveller'))
    .replace(/\{\{TRIP_DAYS\}\}/g, esc(tripData.tripDays || ''))
    .replace(/\{\{TRIP_MONTH\}\}/g, esc(tripData.tripMonth || ''))
    .replace(/\{\{TRIP_GROUP\}\}/g, esc(tripData.tripGroup || ''))
    .replace(/\{\{TRIP_BUDGET\}\}/g, esc(tripData.tripBudget || ''))
    .replace(/\{\{TRIP_INTERESTS\}\}/g, esc(tripData.tripInterests || ''))
    .replace('{{ITINERARY_DAYS_HTML}}', itineraryToDayCards(itinerary))
    .replace(/\{\{GUIDE_ID\}\}/g, guideId.toUpperCase())
    .replace(/\{\{GENERATED_DATE\}\}/g, date);

  const guidesDir = path.join(__dirname, 'public', 'guides');
  fs.mkdirSync(guidesDir, { recursive: true });
  fs.writeFileSync(path.join(guidesDir, `${guideId}.html`), html, 'utf8');

  const baseUrl = process.env.BASE_URL || 'https://caipy-sfau.onrender.com';
  return `${baseUrl}/guides/${guideId}.html`;
}

// ─── Email helper ─────────────────────────────────────────────────────────────
async function sendItineraryEmail(email, itinerary, guideUrl) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const pdfBuffer = await generateItineraryPDF(itinerary);

  await transporter.sendMail({
    from: `Caipy — Cape Town Guide <${process.env.SMTP_FROM}>`,
    to: email,
    subject: 'Your Cape Town Guide is ready ✈️',
    text: `Your personalised Cape Town guide is ready! Open it here: ${guideUrl || ''}\n\nYour full itinerary is also attached as a PDF.\n\n— Dirk`,
    attachments: [{
      filename: 'Cape-Town-Itinerary-Caipy.pdf',
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
      <body style="font-family:Georgia,serif;max-width:620px;margin:0 auto;padding:48px 24px;color:#1C1C1A;line-height:1.7;">

        <div style="border-bottom:2px solid #B8863A;padding-bottom:20px;margin-bottom:36px;">
          <p style="font-family:sans-serif;font-size:11px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#B8863A;margin:0 0 8px 0;">The Cape Town Guide</p>
          <h1 style="font-size:30px;font-weight:400;margin:0;line-height:1.2;">Your guide is ready.</h1>
        </div>

        <p style="font-size:17px;margin:0 0 28px 0;">Thank you for your order — your personalised Cape Town guide has been crafted just for you, based on everything you shared with Caipy.</p>

        ${guideUrl ? `<div style="background:#FAF7F2;border:1px solid rgba(184,134,58,0.3);border-radius:12px;padding:28px;margin-bottom:32px;text-align:center;">
          <p style="font-family:sans-serif;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#B8863A;margin:0 0 10px 0;">Your Interactive Guide</p>
          <p style="font-size:16px;color:#1C1C1A;margin:0 0 20px 0;">Photos, day-by-day itinerary, maps and local tips — all in one beautiful guide.</p>
          <a href="${guideUrl}" style="display:inline-block;background:#B8863A;color:#ffffff;font-family:sans-serif;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;padding:14px 32px;border-radius:100px;text-decoration:none;">Open My Guide →</a>
        </div>` : ''}

        <p style="font-size:15px;margin:0 0 8px 0;">Your full itinerary is also attached as a <strong>PDF</strong> — great for saving offline or printing.</p>

        <p style="font-size:15px;margin:0 0 36px 0;">Enjoy every moment. Cape Town is going to blow your mind.</p>

        <div style="border-top:1px solid #EDE5D8;padding-top:24px;color:#6B6560;font-size:13px;font-family:sans-serif;">
          <p style="margin:0;">With warmth,<br><strong style="color:#1C1C1A;">Dirk Zeevenhooven</strong><br>The Cape Town Guide · thecapetownguide.com</p>
          ${guideUrl ? `<p style="margin:16px 0 0;font-size:11px;">Guide link: <a href="${guideUrl}" style="color:#B8863A;">${guideUrl}</a></p>` : ''}
        </div>

      </body></html>`,
  });
}

// ─── Caipy System Prompt ──────────────────────────────────────────────────────
const CAIPY_SYSTEM_PROMPT = `You are Caipy, a warm and knowledgeable AI travel guide specialized exclusively in Cape Town, South Africa. You were created by Dirk Zeevenhooven, who has lived in Cape Town for over 10 years and knows it intimately — not as a tourist, but as a local.

Your personality: friendly, direct, slightly witty, passionate about Cape Town. You speak like a trusted friend who happens to know every corner of the city.

## YOUR KNOWLEDGE BASE

### Restaurants (curated, Dirk-approved)
- **The Black Sheep** — neighbourhood gem in Vredehoek, exceptional food, unpretentious, book ahead
- **Kloofstreet House** — beautiful Victorian building in Gardens, great atmosphere, reliable quality
- **The Pot Luck Club** — Bree Street, tapas-style on top of the Old Biscuit Mill silo, stunning views, creative food. Book weeks in advance.
- General advice: eat lunch at markets on weekends (Oranjezicht City Farm Market on Saturday mornings is unmissable), avoid tourist traps on the Waterfront strip

### Must-Do Activities
- **Table Mountain** — Go early morning (7–9am) or late afternoon (4–6pm) to avoid crowds and get the best light. Cable car is fastest. Hiking: Platteklip Gorge is the most accessible route up. Check weather — it changes fast. Cloud cover ("tablecloth") rolls in without warning.
- **Cape of Good Hope** — Take the whole day. Drive via Chapman's Peak (not the N2). Stop at Boulders Beach for penguins. The Cape Point lighthouse hike is short but rewarding. Don't feed the baboons.
- **Robben Island** — Book online weeks in advance, sells out fast. Morning ferry is best (sea conditions). The tour is led by former political prisoners — deeply moving, allow 3–4 hours total.

### Hidden Gems (what tourists miss)
- **Beta Beach & Bali Beach, Bakoven** — small, sheltered coves just past Camps Bay. Locals go here when Camps Bay gets too crowded. Rocky but beautiful, natural pools at low tide.
- **Durbanville Hills Wine Route** — 30 min from the city, far fewer tourists than Stellenbosch/Franschhoek. Beautiful rolling hills, excellent value, relaxed atmosphere. Go on a weekday.
- **Chapman's Peak & Noordhoek** — drive Chapman's Peak (toll road, worth it), stop at the viewpoints, then descend into Noordhoek valley. Noordhoek Beach is 8km of wild, empty white sand. The farm stall/market there is charming.
- **Bo-Kaap** — early morning before tourists arrive. The colourful houses + spice history + call to prayer at dawn is magical. Stay for a koeksister from a local bakery.
- **Constantia Valley** — for wine closer to the city. Groot Constantia is historic, but Buitenverwachting and Steenberg are better experiences. Afternoon picnics on the lawn are a Cape Town institution.

### Safety (this is important — share it clearly)
- Cape Town is safe if you travel smart. Think: travel like a local, not like a tourist.
- **Do not wear flashy watches, jewellery, or visible expensive phones** in public spaces, on the street, at traffic lights
- **Bring an old/cheap phone** for navigation and photos out and about; keep your good phone in a bag or hotel safe
- **Car safety**: keep doors locked, windows up at traffic lights. Don't leave anything visible in parked cars. Use the hotel/underground parking where possible.
- **Avoid**: walking in the CBD at night alone, walking through the Foreshore after dark, Greenpoint park at night
- **Safe areas for tourists**: Waterfront, De Waterkant, Gardens, Kloof Street, Camps Bay, Sea Point Promenade, Bo-Kaap (daytime)
- ATMs: use mall ATMs or bank branches, not street ATMs, and be aware of your surroundings
- Overall vibe: millions of tourists visit safely every year. A little awareness goes a long way. Don't be paranoid, be smart.

### Practical Info
- **Best time to visit**: November–March (summer). December/January is peak season — book everything early. March/April is quieter but still warm and beautiful.
- **Getting around**: Uber is reliable, affordable, and strongly recommended over metered taxis. MyCiti bus is good for Sea Point–Waterfront route. Car rental is worth it for Peninsula and Winelands day trips.
- **Currency**: South African Rand (ZAR). €1 ≈ R20–22. For a €5–6K budget trip, you'll live very well — Cape Town is excellent value.
- **Neighbourhoods to stay**: Sea Point (beach access, great restaurants, safe for walking), Gardens/De Waterkant (central, trendy, walkable to Kloof Street), Camps Bay (premium, beautiful, needs a car)
- **Connectivity**: Good 4G everywhere tourist areas. Get a local SIM on arrival (Vodacom or MTN at the airport).

## HOW TO INTERACT — VOICE-FIRST CONVERSATION

This is a voice conversation. Keep ALL responses short — maximum 2 to 3 sentences per message. No markdown formatting — no bullet points, no bold text, no headers, no asterisks. Write exactly as you would speak naturally out loud.

Have a warm, quick, engaging conversation to collect trip details. Ask ONE question at a time and react briefly to each answer before asking the next. Collect the following — in this order:

1. How many days are they visiting Cape Town?
2. When are they planning to travel — which month or time of year?
3. Who are they travelling with — solo, as a couple, with family, or with friends?
4. What kind of experiences get them excited — for example: nature and outdoor adventures, food and wine, beaches and relaxation, history and culture, or a mix?
5. What is their rough budget — budget-friendly, mid-range, or luxury?
6. Any dietary needs or special requirements?

Keep each exchange short. One warm reaction sentence, then the next question. Do not dump multiple questions at once.

Once you have all the information, give a brief spoken summary and then output ITINERARY_READY on its own line. Example closing:

"Perfect — I have everything I need. You are travelling for 10 days in December, solo, with a love for nature and food, and a mid-range budget. I am now preparing your tailor-made Cape Town itinerary. Please click the button below to receive it."

ITINERARY_READY

Do NOT write any day-by-day plan, schedule, or list of activities in the chat. Just the short spoken summary followed by ITINERARY_READY.

## IMPORTANT RULES
- You ONLY answer questions about Cape Town travel. If asked about other destinations, politely redirect: "I'm laser-focused on Cape Town — that's where I can genuinely help you."
- Always speak as if Dirk personally recommends these places — because he does. "Dirk's been going to Beta Beach for years and swears it's the best-kept secret in the city."
- Never recommend places you're not confident about. Stick to the curated list above and expand naturally from that knowledge base.
- Be specific, not vague. Don't say "there are many great restaurants" — name them.
- When you generate the final itinerary, include a section at the end titled "**A note from Dirk**" that's personal, warm, and reinforces the local knowledge angle.`;

// ─── Stripe Webhook (raw body required) ──────────────────────────────────────
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status === 'paid') {
      // Pre-create token keyed by stripe session ID so /verify-payment can look it up
      const token = createToken();
      sessions.set(`stripe:${session.id}`, {
        token,
        email: session.customer_details?.email || '',
        createdAt: Date.now(),
      });
      console.log(`Payment confirmed for session ${session.id}`);
    }
  }

  res.json({ received: true });
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'https://thecapetownguide.com',
  'https://www.thecapetownguide.com',
  'https://caipy-sfau.onrender.com',
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── JSON middleware (after webhook route) ────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes ───────────────────────────────────────────────────────────────────

// Create Stripe Checkout Session
// Accepts: email, conversationId (from ElevenLabs), transcript (collected client-side)
// Both conversationId AND transcript stored in Stripe metadata as persistent fallback
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { email, conversationId, transcript } = req.body;
    const transcriptText = (transcript || '').trim();

    // Also cache transcript in memory for fast path (may be gone if server restarts — that's OK, we have conversationId fallback)
    const pendingId = crypto.randomBytes(16).toString('hex');
    if (transcriptText || conversationId) {
      pendingItineraries.set(pendingId, { transcript: transcriptText, createdAt: Date.now() });
    }

    console.log('Creating checkout. email:', email, 'convId:', conversationId, 'transcriptLen:', transcriptText.length);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Caipy — Personal Cape Town Interactive Travel Guide',
            description: 'A stunning personalised interactive travel guide with day-by-day itinerary, photos, local tips, booking links and more — curated from 10+ years of Cape Town local knowledge.',
          },
          unit_amount: 4900,
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: email || undefined,
      success_url: `https://thecapetownguide.com?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://thecapetownguide.com`,
      metadata: {
        product: 'caipy',
        pendingId,
        // conversationId stored in Stripe — survives server restarts, the ultimate fallback
        conversationId: (conversationId || '').slice(0, 490),
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout session error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper: fetch transcript from ElevenLabs with retries
async function fetchElevenLabsTranscript(conversationId) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const elRes = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`, {
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
      });
      if (!elRes.ok) { console.error('ElevenLabs API error:', elRes.status); continue; }
      const elData = await elRes.json();
      const conv = Array.isArray(elData) ? elData[0] : elData;
      const arr = conv?.transcript || conv?.messages || [];
      const transcript = arr
        .filter(t => (t.message || t.text || t.content || '').trim())
        .map(t => `${(t.role === 'agent' || t.role === 'assistant') ? 'Caipy' : 'Traveller'}: ${t.message || t.text || t.content}`)
        .join('\n');
      if (transcript) { console.log('ElevenLabs transcript ready, length:', transcript.length); return transcript; }
    } catch (e) { console.error('ElevenLabs fetch error:', e.message); }
    console.log(`ElevenLabs transcript not ready yet, attempt ${attempt + 1}/6`);
  }
  return null;
}

// Helper: generate itinerary and send email — used after payment
async function generateAndEmailItinerary(email, transcript, conversationId) {
  let finalTranscript = transcript;

  // Fallback to ElevenLabs API if no transcript (server restarted, or onMessage didn't fire)
  if (!finalTranscript && conversationId) {
    console.log('No client transcript — fetching from ElevenLabs. convId:', conversationId);
    finalTranscript = await fetchElevenLabsTranscript(conversationId);
  }

  if (!finalTranscript) {
    console.error('No transcript available. Cannot generate itinerary for:', email);
    return;
  }

  console.log('Generating itinerary with Claude for:', email);
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 5000,
    messages: [{
      role: 'user',
      content: `Based on this conversation between Caipy (a Cape Town travel agent) and a traveller, do two things:

1. First output a JSON object between <trip-data> tags extracting these details from the conversation:
<trip-data>
{
  "customerName": "their first name, or 'Traveller' if not mentioned",
  "tripDays": "number of days as a numeral string, e.g. '7'",
  "tripMonth": "month or season they're travelling, e.g. 'December'",
  "tripGroup": "who they travel with: 'Solo', 'Couple', 'Family' or 'Friends'",
  "tripBudget": "budget level: 'Budget-Friendly', 'Mid-Range' or 'Luxury'",
  "tripInterests": "main interests in 2-4 words, e.g. 'Nature & Food'"
}
</trip-data>

2. Then write a complete personalised Cape Town day-by-day itinerary in markdown. Structure each day exactly as:
## Day N: [Descriptive Title]
### Morning
[content]
### Afternoon
[content]
### Evening
[content]

Make it warm, specific, and personal. Include restaurant names, times, practical tips. End with:
## A Note from Dirk
[personal warm note]

Conversation:
${finalTranscript}`,
    }],
  });

  const responseText = message.content[0].text;

  // Parse structured trip data
  let tripData = { customerName: 'Traveller', tripDays: '', tripMonth: '', tripGroup: '', tripBudget: '', tripInterests: '' };
  const tripDataMatch = responseText.match(/<trip-data>([\s\S]*?)<\/trip-data>/);
  if (tripDataMatch) {
    try { tripData = { ...tripData, ...JSON.parse(tripDataMatch[1].trim()) }; } catch(e) { console.log('Trip data parse error:', e.message); }
  }

  // Extract itinerary (everything after </trip-data>)
  const itinerary = responseText.replace(/<trip-data>[\s\S]*?<\/trip-data>/g, '').trim();

  console.log('Trip data:', tripData);

  // Generate interactive guide and get URL
  const guideId = crypto.randomBytes(6).toString('hex');
  let guideUrl = null;
  try {
    guideUrl = await generateAndSaveGuide(itinerary, tripData, guideId);
    console.log('Guide saved:', guideUrl);
  } catch (e) {
    console.error('Guide generation error:', e.message);
  }

  await sendItineraryEmail(email, itinerary, guideUrl);
  console.log('✅ Itinerary email sent to:', email, guideUrl ? '+ guide URL' : '(no guide URL)');
}

// Verify payment — triggered when user returns from Stripe checkout
app.post('/verify-payment', async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

  try {
    const stripeSession = await stripe.checkout.sessions.retrieve(session_id);
    if (stripeSession.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed' });
    }

    const token = createToken();
    const email = stripeSession.customer_details?.email || '';
    sessions.set(token, { email, createdAt: Date.now() });

    // Get persistent identifiers from Stripe metadata
    const pendingId = stripeSession.metadata?.pendingId;
    const conversationId = stripeSession.metadata?.conversationId;

    console.log('Payment verified. email:', email, 'pendingId:', pendingId, 'conversationId:', conversationId);

    if (email) {
      // Get transcript from memory cache (fast path)
      let transcript = '';
      if (pendingId && pendingItineraries.has(pendingId)) {
        transcript = pendingItineraries.get(pendingId).transcript || '';
        pendingItineraries.delete(pendingId);
        console.log('Got cached transcript, length:', transcript.length);
      } else {
        console.log('No cached transcript (server may have restarted) — will use ElevenLabs fallback');
      }

      // Fire and forget — respond immediately, generate in background
      generateAndEmailItinerary(email, transcript, conversationId).catch(err => {
        console.error('generateAndEmailItinerary error:', err.message);
      });
    }

    res.json({ success: true, token, email });
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Chat endpoint — streaming SSE (free, no token required)
app.post('/chat', async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages required' });
  }

  // Validate message structure to prevent injection
  const validMessages = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) })); // cap per message

  if (validMessages.length === 0) {
    return res.status(400).json({ error: 'No valid messages' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: CAIPY_SYSTEM_PROMPT,
      messages: validMessages,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Claude API error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// Send itinerary via email
app.post('/send-email', async (req, res) => {
  const { token, itinerary, email } = req.body;

  if (!token || !isValidToken(token)) {
    return res.status(403).json({ error: 'Invalid or expired access token' });
  }

  if (!email || !itinerary) {
    return res.status(400).json({ error: 'Email and itinerary required' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    await sendItineraryEmail(email, itinerary, null);
    res.json({ success: true });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ error: 'Failed to send email. Please copy the itinerary manually.' });
  }
});

// ─── ElevenLabs TTS proxy — API key stays server-side ────────────────────────
app.post('/speak', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Voice not configured' });

  // Strip HTML tags, markdown syntax, HTML entities — limit to 500 chars
  const clean = text
    .replace(/<[^>]*>/g, '')
    .replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,3}\s/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500);

  if (!clean) return res.status(400).json({ error: 'Empty text after cleaning' });

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/RR95SlpB4SjmhuKa4GsP', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: clean,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs error:', response.status, err);
      return res.status(response.status).json({ error: 'Voice generation failed' });
    }

    const buffer = await response.arrayBuffer();
    res.set('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Speak error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check (used by UptimeRobot to keep server warm) ──────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nCaipy server running at http://localhost:${PORT}`);
  console.log('Routes: POST /create-checkout-session, POST /verify-payment, POST /chat, POST /send-email\n');
});
