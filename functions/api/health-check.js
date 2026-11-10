// Cloudflare Pages Function: POST /api/health-check
// Recomputes the Foundation Health Check scores, emails the full results through Brevo,
// and adds the person to the newsletter list only if they ticked the consent box.
//
// Environment variables (Cloudflare Pages > Settings > Variables and secrets):
//   BREVO_API_KEY   (secret, required)  Brevo API v3 key
//   SENDER_EMAIL    (optional) defaults to info@sa-analytical.com (must be a verified Brevo sender)
//   SENDER_NAME     (optional) defaults to "SA Analytical"
//   BREVO_LIST_ID   (optional) numeric ID of the newsletter list; if unset, nobody is added to a list
//   NOTIFY_EMAIL    (optional) if set, a short summary of each submission is sent here

const DIMENSIONS = [
  { key: "mission", name: "Mission & strategy", n: 4,
    bands: ["Priorities are implicit or shift with each grant round.", "A written strategy exists but rarely shapes decisions.", "Strategy guides most grant decisions and is broadly shared.", "A clear theory of change drives choices, including what to stop funding."],
    steps: ["Write a one-page theory of change and test it with staff and board.", "Review last year's grants against it: which fit, which didn't, and why.", "Set a time horizon or exit criteria for each main programme."] },
  { key: "governance", name: "Governance", n: 4,
    bands: ["Roles and decision rights are informal.", "Roles are written down but blur in practice.", "Clear roles, a skilled board and managed conflicts of interest.", "The board reviews itself and renews deliberately."],
    steps: ["Draft a simple decision-rights matrix: what the board decides, what staff decide.", "Map board skills and perspectives against the strategy, and plan recruitment to fill gaps.", "Schedule a facilitated board self-review within the next twelve months."] },
  { key: "grantmaking", name: "Grantmaking practice", n: 4,
    bands: ["Processes vary by staff member or case.", "Criteria exist but burden and timelines are not managed.", "Consistent, proportionate and timely processes.", "Flexible, multi-year funding and light processes by design."],
    steps: ["Time each stage of your grant cycle and publish a decision timeline.", "Scale application and reporting requirements to grant size.", "Set a target share of unrestricted or multi-year funding and track it."] },
  { key: "relationships", name: "Relationships & power", n: 4,
    bands: ["Little structured contact with grantees beyond reporting.", "Informal feedback from a few trusted grantees.", "Regular anonymous feedback that is acted on.", "Grantees and communities help shape strategy."],
    steps: ["Run an anonymous grantee feedback survey, ideally through a third party.", "Share back what you heard and one change you will make as a result.", "Create a regular route for community input into your priorities."] },
  { key: "learning", name: "Learning & impact", n: 4,
    bands: ["Reports are collected but rarely read.", "Some analysis, mostly for accountability.", "Data and learning feed into annual decisions.", "Learning questions drive strategy and are shared openly."],
    steps: ["Agree three to five learning questions for your strategy.", "Bring one theme from grantee reports into your next strategy review.", "Publish one honest learning note, including what didn't work."] },
  { key: "people", name: "People & culture", n: 4,
    bands: ["An overstretched team, with knowledge held by individuals.", "Gaps are known but not yet addressed.", "Manageable workloads and open debate.", "A deliberate culture of candour and development."],
    steps: ["Compare portfolio sizes per programme officer with peers and rebalance where needed.", "Run a short anonymous staff survey on workload and openness.", "Build a skills plan that follows from the strategy."] },
  { key: "operations", name: "Operations & systems", n: 4,
    bands: ["Spreadsheets and workarounds, with key-person risk.", "A core system is in place but data quality is uneven.", "Reliable systems and documented processes.", "Systems give real-time insight into the portfolio."],
    steps: ["List the processes that depend on one person and document those first.", "Check grants data quality on a sample of records.", "Review data protection and safeguarding policies against what happens in practice."] },
  { key: "finance", name: "Finance & assets", n: 4,
    bands: ["Costs and payout are not actively reviewed.", "Reviewed for compliance only.", "Spending and costs are managed against plan.", "Investments and spending are actively aligned with mission."],
    steps: ["Calculate operating costs as a share of grant spend and compare with similar foundations.", "Review your payout or spending policy against your strategy's time horizon.", "Screen the investment portfolio for holdings that conflict with your mission."] },
  { key: "external", name: "External positioning", n: 4,
    bands: ["Works mostly alone; role in the field is unclear.", "Some collaboration, mostly ad hoc.", "A clear niche and regular co-funding.", "Uses its voice and networks to shape the field."],
    steps: ["Map the other funders in your field and where you add distinct value.", "Identify one co-funding or pooled-fund opportunity to explore this year.", "Decide where your voice, convening or networks can add to your grants."] }
];
const TOTAL = DIMENSIONS.reduce((n, d) => n + d.n, 0);
const BANDS = ["Nascent", "Developing", "Established", "Leading"];
const ROLES = ["CEO or director", "Programme staff", "Operations or finance", "Board member", "Other"];

const C = { gold: "#b5943f", cream: "#f4f0e8", sand: "#e9e2d7", card: "#faf7f1", charcoal: "#2b2b2e", text: "#2e2c29", text2: "#5f5a52", muted: "#8a8278", border: "#e2dacb" };

function bandIndex(s) { return s < 1.75 ? 0 : s < 2.5 ? 1 : s < 3.25 ? 2 : 3; }

export function scoreAnswers(answers) {
  let o = 0;
  return DIMENSIONS.map((d) => {
    const vals = answers.slice(o, o + d.n); o += d.n;
    const known = vals.filter((v) => v > 0);
    const dk = vals.length - known.length;
    const score = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
    const blind = dk >= 2 || score === null;
    const bi = blind ? null : bandIndex(score);
    return { ...d, score, blind, bandIndex: bi, band: blind ? null : BANDS[bi] };
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function listJoin(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }

export function buildEmail(results, firstName) {
  const scored = results.filter((d) => !d.blind);
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  // Same rule as the page: two strongest and two weakest, or one each when few dimensions are scored
  const k = sorted.length >= 4 ? 2 : 1;
  const strengths = sorted.length >= 2 ? sorted.slice(0, k) : [];
  const gaps = sorted.length >= 2 ? sorted.slice(-k).reverse() : [];
  const blind = results.filter((d) => d.blind);
  const greeting = firstName ? `Dear ${esc(firstName)},` : "Hello,";

  const rows = results.map((d) => {
    const pct = d.blind ? 0 : Math.max(Math.round(((d.score - 1) / 3) * 100), 3);
    const bar = d.blind
      ? `<span style="font-family:Arial,sans-serif;color:${C.muted};font-size:13px;">Blind spot</span>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.sand};border-radius:5px;"><tr><td width="${pct}%" style="background:${C.gold};height:10px;border-radius:5px;font-size:0;line-height:0;">&nbsp;</td><td style="font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
    const label = d.blind ? "" : `<strong>${d.score.toFixed(1)}</strong> ${d.band}`;
    const desc = d.blind
      ? `You answered "Don't know" to two or more statements here, so we haven't given a band.`
      : esc(d.bands[d.bandIndex]);
    return `<tr><td style="padding:14px 0;border-bottom:1px solid ${C.border};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:${C.text};">${esc(d.name)}</td>
        <td align="right" style="font-family:Arial,sans-serif;font-size:14px;color:${C.text2};white-space:nowrap;">${label}</td></tr>
        <tr><td colspan="2" style="padding:8px 0 6px;">${bar}</td></tr>
        <tr><td colspan="2" style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:${C.text2};">${desc}</td></tr>
      </table></td></tr>`;
  }).join("");

  const stepsHtml = gaps.map((d) => `
    <h3 style="font-family:Arial,sans-serif;font-size:16px;color:${C.text};margin:24px 0 8px;">${esc(d.name)} <span style="font-weight:normal;color:${C.text2};">(${d.score.toFixed(1)}, ${d.band})</span></h3>
    <ol style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:${C.text};margin:0;padding-left:20px;">
      ${d.steps.map((s) => `<li style="margin-bottom:6px;">${esc(s)}</li>`).join("")}
    </ol>`).join("");

  const blindHtml = blind.length ? `
    <p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:${C.text2};border-left:2px solid ${C.gold};padding-left:14px;margin:24px 0 0;">
      You answered "Don't know" to several questions on ${esc(listJoin(blind.map((d) => d.name)))}. That is worth noting in itself: it often means information isn't reaching the people who need it.</p>` : "";

  const summary = strengths.length && gaps.length
    ? `Your strongest areas are <strong>${esc(listJoin(strengths.map((d) => d.name)))}</strong>; the areas with most room to grow are <strong>${esc(listJoin(gaps.map((d) => d.name)))}</strong>.`
    : "Here is how your foundation rated itself across the nine dimensions.";

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${C.cream};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
    <tr><td style="background:${C.charcoal};padding:18px 28px;font-family:Arial,sans-serif;font-weight:bold;letter-spacing:3px;color:${C.gold};font-size:14px;">SA ANALYTICAL</td></tr>
    <tr><td style="background:${C.card};padding:32px 28px;border:1px solid ${C.border};border-top:none;">
      <p style="font-family:Arial,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${C.gold};font-weight:bold;margin:0 0 12px;">Foundation Health Check</p>
      <h1 style="font-family:Arial,sans-serif;font-size:24px;line-height:1.25;color:${C.text};margin:0 0 20px;">Your full results</h1>
      <p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:${C.text};margin:0 0 12px;">${greeting}</p>
      <p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:${C.text};margin:0 0 8px;">Thank you for completing the Foundation Health Check. ${summary}</p>
      <p style="font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:${C.muted};margin:0 0 16px;">Scores run from 1 to 4. Bands: Nascent (below 1.75), Developing (1.75 to 2.49), Established (2.5 to 3.24), Leading (3.25 and above).</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      ${blindHtml}
      ${gaps.length ? `<h2 style="font-family:Arial,sans-serif;font-size:19px;color:${C.text};margin:32px 0 4px;">Three steps for your lowest-scoring areas</h2>${stepsHtml}` : ""}
      <h2 style="font-family:Arial,sans-serif;font-size:19px;color:${C.text};margin:32px 0 8px;">The view from outside</h2>
      <p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:${C.text};margin:0 0 20px;">A self-assessment shows how your foundation sees itself. The most useful insights often come from comparing that view with how grantees, staff and board experience it. SA Analytical's comprehensive health check brings those perspectives together with an analysis of your grants data, and turns the findings into priorities in a facilitated workshop with your leadership.</p>
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${C.gold};border-radius:4px;">
        <a href="mailto:info@sa-analytical.com?subject=Foundation%20Health%20Check%20conversation" style="display:inline-block;padding:13px 22px;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#1a1a1b;text-decoration:none;">Book a 30-minute conversation</a>
      </td></tr></table>
      <p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:${C.text};margin:28px 0 0;">With best wishes,<br>Ekci Suyapno<br><span style="color:${C.text2};">Founder, SA Analytical</span></p>
    </td></tr>
    <tr><td style="background:${C.charcoal};padding:16px 28px;font-family:Arial,sans-serif;font-size:12px;color:#f5efe6;">SA Analytical &middot; <a href="https://sa-analytical.com" style="color:#f5efe6;">sa-analytical.com</a> &middot; You received this email because you requested your Foundation Health Check results.</td></tr>
  </table></td></tr></table></body></html>`;

  const text = [
    firstName ? `Dear ${firstName},` : "Hello,", "",
    "Thank you for completing the Foundation Health Check. Your scores (1 to 4):", "",
    ...results.map((d) => d.blind ? `${d.name}: blind spot` : `${d.name}: ${d.score.toFixed(1)} ${d.band} - ${d.bands[d.bandIndex]}`),
    "",
    ...(gaps.length ? ["Three steps for your lowest-scoring areas:", ...gaps.flatMap((d) => [`${d.name}:`, ...d.steps.map((s, i) => `  ${i + 1}. ${s}`)]), ""] : []),
    "To talk about a comprehensive health check, reply to this email or write to info@sa-analytical.com.", "",
    "Ekci Suyapno", "Founder, SA Analytical"
  ].join("\n");

  return { html, text, subject: "Your Foundation Health Check results" };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function brevo(env, path, payload) {
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Brevo ${path} ${res.status}: ${await res.text()}`);
  return res;
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  // Honeypot: bots fill the hidden field. Pretend success.
  if (body.website) return json({ ok: true });

  const email = String(body.email || "").trim().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
  const answers = Array.isArray(body.answers) ? body.answers.map(Number) : [];
  if (answers.length !== TOTAL || answers.some((v) => ![0, 1, 2, 3, 4].includes(v))) return json({ ok: false, error: "invalid_answers" }, 400);
  const firstName = String(body.firstName || "").trim().slice(0, 60);
  const role = ROLES.includes(body.role) ? body.role : "Other";
  if (!env.BREVO_API_KEY) return json({ ok: false, error: "not_configured" }, 500);

  const results = scoreAnswers(answers);
  const mail = buildEmail(results, firstName);
  const sender = { email: env.SENDER_EMAIL || "info@sa-analytical.com", name: env.SENDER_NAME || "SA Analytical" };

  try {
    await brevo(env, "/smtp/email", {
      sender, to: [{ email, ...(firstName ? { name: firstName } : {}) }], replyTo: sender,
      subject: mail.subject, htmlContent: mail.html, textContent: mail.text, tags: ["health-check"]
    });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "send_failed" }, 502);
  }

  // Newsletter sign-up, only with consent. Failure here doesn't affect the results email.
  if (body.newsletter === true && env.BREVO_LIST_ID) {
    try {
      await brevo(env, "/contacts", {
        email, updateEnabled: true, listIds: [Number(env.BREVO_LIST_ID)],
        attributes: firstName ? { FIRSTNAME: firstName } : {}
      });
    } catch (err) { console.error(err); }
  }

  if (env.NOTIFY_EMAIL) {
    const lines = results.map((d) => `${d.name}: ${d.blind ? "blind spot" : d.score.toFixed(1) + " " + d.band}`);
    try {
      await brevo(env, "/smtp/email", {
        sender, to: [{ email: env.NOTIFY_EMAIL }],
        subject: `New Health Check: ${role}${body.newsletter === true ? " (newsletter)" : ""}`,
        textContent: [`Email: ${email}`, `Name: ${firstName || "-"}`, `Role: ${role}`, `Newsletter: ${body.newsletter === true ? "yes" : "no"}`, "", ...lines].join("\n")
      });
    } catch (err) { console.error(err); }
  }

  return json({ ok: true });
}

export function onRequest() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
