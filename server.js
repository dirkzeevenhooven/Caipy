// Caipy — Cape Town Itinerary Chatbot Backend
// Node.js + Express + Stripe + Claude API

require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Session store (use Redis/DB in production) ───────────────────────────────
// Maps accessToken → { email, createdAt }
const sessions = new Map();

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isValidToken(token) {
  if (!sessions.has(token)) return false;
  const { createdAt } = sessions.get(token);
  // Tokens valid for 30 days
  return Date.now() - createdAt < 30 * 24 * 60 * 60 * 1000;
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

## HOW TO INTERACT

When a user first starts chatting, greet them warmly and collect the following information before generating the itinerary. Ask these questions conversationally — one or two at a time, not all at once:

1. How many days are they visiting Cape Town? (target: 14–21 days)
2. What are their main interests? When listing options, format them as **A.** **B.** **C.** **D.** **E.** — never use bullet points for option lists.
3. What's their travel style? (relaxed/slow travel vs. action-packed / somewhere in between)
4. Are they travelling solo, as a couple, with family, or friends?
5. Any dietary restrictions or preferences?

Once you have this info, generate the complete **day-by-day itinerary** internally — but do NOT output it in the chat. Instead, output the full itinerary inside a hidden block like this:

<!--ITINERARY_START-->
[full itinerary here]
<!--ITINERARY_END-->

Then, after that hidden block, output ONLY this message to the user (personalised with their destination/duration):

"Your personalised [X]-day Cape Town itinerary is ready. It includes your day-by-day plan, restaurant picks, hidden gems, and a personal note from Dirk. Click the button below to receive it in your inbox."

Never show the itinerary content directly in the chat. The hidden block will be captured by the system and delivered by email after payment.

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

// ─── JSON middleware (after webhook route) ────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes ───────────────────────────────────────────────────────────────────

// Create Stripe Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Caipy — Personal Cape Town Itinerary',
              description:
                'Chat with Caipy and get a complete personalised day-by-day Cape Town itinerary, curated from 10+ years of local knowledge.',
              images: [],
            },
            unit_amount: 4900, // €49.00
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: req.body.email || undefined,
      success_url: `https://caipy-sfau.onrender.com/chat.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://caipy-sfau.onrender.com/caipy.html`,
      metadata: { product: 'caipy' },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout session error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Verify payment and issue access token
app.post('/verify-payment', async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

  try {
    // Check if webhook already processed it
    const preCreated = sessions.get(`stripe:${session_id}`);
    if (preCreated) {
      sessions.delete(`stripe:${session_id}`);
      sessions.set(preCreated.token, { email: preCreated.email, createdAt: preCreated.createdAt });
      return res.json({ success: true, token: preCreated.token, email: preCreated.email });
    }

    // Fallback: verify directly with Stripe
    const stripeSession = await stripe.checkout.sessions.retrieve(session_id);
    if (stripeSession.payment_status !== 'paid') {
      return res.status(402).json({ error: 'Payment not completed' });
    }

    const token = createToken();
    const email = stripeSession.customer_details?.email || '';
    sessions.set(token, { email, createdAt: Date.now() });

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

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // Convert markdown-ish itinerary to simple HTML
    const htmlItinerary = itinerary
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\n/g, '<br>');

    await transporter.sendMail({
      from: `Caipy — Cape Town Guide <${process.env.SMTP_FROM}>`,
      to: email,
      subject: 'Your Cape Town Itinerary from Caipy',
      text: itinerary,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Georgia, serif; max-width: 680px; margin: 0 auto; padding: 40px 20px; color: #1C1C1A; line-height: 1.7;">
          <div style="border-bottom: 2px solid #B8863A; padding-bottom: 24px; margin-bottom: 32px;">
            <h1 style="font-size: 28px; font-weight: 400; margin: 0 0 4px 0;">Your Cape Town Itinerary</h1>
            <p style="color: #6B6560; margin: 0; font-size: 14px; font-family: sans-serif; letter-spacing: 1px; text-transform: uppercase;">Curated by Caipy · Dirk's local knowledge</p>
          </div>
          <div style="font-size: 16px;">${htmlItinerary}</div>
          <div style="margin-top: 48px; padding-top: 24px; border-top: 1px solid #EDE5D8; color: #6B6560; font-size: 13px; font-family: sans-serif;">
            <p>Generated by Caipy — powered by 10+ years of Cape Town local knowledge from Dirk Zeevenhooven.</p>
          </div>
        </body>
        </html>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ error: 'Failed to send email. Please copy the itinerary manually.' });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nCaipy server running at http://localhost:${PORT}`);
  console.log('Routes: POST /create-checkout-session, POST /verify-payment, POST /chat, POST /send-email\n');
});
