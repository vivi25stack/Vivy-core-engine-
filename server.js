require('dotenv').config();

const express = require('express');
const http = require('http');
const { neon } = require('@neondatabase/serverless');

const app = express();
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

const sql = neon(process.env.DATABASE_URL);
const server = http.createServer(app);

const HOST_MINIMUM_COINS = 10000; 
const COIN_TO_USD_VALUE = 0.001;  
const DEDUCTION_PER_30_SECONDS = 250; 

// ==========================================
// 1. ENDPOINTS
// ==========================================
app.post('/api/register/host', async (req, res) => {
  const { username, email, inviteCode } = req.body;
  if (!username || !email || !inviteCode) return res.status(400).json({ error: "Missing fields." });
  try {
    const agency = await sql`SELECT id FROM agencies WHERE invite_code = ${inviteCode} AND is_approved = TRUE`;
    if (!agency[0]) return res.status(400).json({ error: "Invalid or unapproved agency code." });
    const userResult = await sql`INSERT INTO users (username, email, role, is_approved) VALUES (${username}, ${email}, 'host', FALSE) RETURNING id`;
    await sql`INSERT INTO host_profiles (host_id, agency_id, earned_coins_balance, is_agency_locked) VALUES (${userResult[0].id}, ${agency[0].id}, 0, TRUE)`;
    return res.json({ message: "Registered! Awaiting Admin Approval." });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ==========================================
// 2. UNIFIED VISUAL CONTROL CENTER
// ==========================================
app.get('/admin', async (req, res) => {
  try {
    const agencies = await sql`SELECT id, agency_name, owner_name, commission_rate, wallet_balance_usd, usdt_wallet_address, invite_code, is_approved FROM agencies ORDER BY id DESC`;
    const hostProfiles = await sql`
      SELECT hp.host_id, u.username, hp.earned_coins_balance, a.agency_name, hp.is_agency_locked, u.is_approved
      FROM host_profiles hp
      JOIN users u ON hp.host_id = u.id
      LEFT JOIN agencies a ON hp.agency_id = a.id
      ORDER BY u.id DESC
    `;
    const payrollLogs = await sql`
      SELECT p.id, a.agency_name, p.amount_paid_usd, p.payment_date 
      FROM agency_payroll p 
      JOIN agencies a ON p.agency_id = a.id 
      ORDER BY p.payment_date DESC
    `;

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Vivy Master Ecosystem</title>
      <style>
        body { font-family: -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 12px; margin: 0; }
        h1 { color: #38bdf8; font-size: 20px; text-align: center; margin-bottom: 15px; }
        .card { background: #1e293b; padding: 12px; border-radius: 8px; margin-bottom: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); }
        h2 { font-size: 14px; margin-top: 0; color: #f472b6; border-bottom: 1px solid #334155; padding-bottom: 5px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { text-align: left; padding: 6px; border-bottom: 1px solid #334155; vertical-align: top; }
        th { color: #94a3b8; }
        .actions-cell { display: flex; flex-direction: column; gap: 4px; }
        .btn { border: none; padding: 4px 6px; border-radius: 4px; font-weight: bold; font-size: 9px; cursor: pointer; text-align: center; color: white; display: block; width: 100%; box-sizing: border-box; }
        .btn-approve { background: #eab308; color: #0f172a; }
        .btn-reject { background: #ef4444; }
        .btn-pay { background: #22c55e; }
        .btn-lock { background: #3b82f6; }
        .btn-disabled { background: #475569 !important; color: #94a3b8; cursor: not-allowed; }
        .badge { display: inline-block; padding: 2px 4px; border-radius: 4px; font-size: 9px; font-weight: bold; }
        .badge-active { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
        .badge-pending { background: rgba(234, 179, 8, 0.2); color: #eab308; }
        code { background: #0f172a; padding: 2px 4px; border-radius: 4px; color: #38bdf8; font-size: 10px; word-break: break-all; }
      </style>
    </head>
    <body>
      <h1>📱 Vivy Master Command Center</h1>

      <div class="card">
        <h2>🏢 Agency Registration & Finance Hub</h2>
        <table>
          <tr><th>Agency Profile</th><th>Wallet Address</th><th>Status</th><th>Available Actions</th></tr>
    `;

    agencies.forEach(a => {
      const generatedCode = a.invite_code || `VIVY-${a.id}99`;
      html += `
        <tr>
          <td><b>${a.agency_name}</b><br><span style="color:#94a3b8;font-size:9px;">Code: <code>${generatedCode}</code></span><br><span style="color:#22c55e;">$${parseFloat(a.wallet_balance_usd || 0).toFixed(2)}</span></td>
          <td><code>${a.usdt_wallet_address || 'Unconfigured'}</code></td>
          <td><span class="badge ${a.is_approved ? 'badge-active' : 'badge-pending'}">${a.is_approved ? 'Active' : 'Pending'}</span></td>
          <td class="actions-cell">
            <form action="/admin/approve-agency" method="POST" style="margin:0;">
              <input type="hidden" name="id" value="${a.id}">
              <input type="hidden" name="fallbackCode" value="${generatedCode}">
              <button type="submit" class="btn btn-approve" ${a.is_approved ? 'disabled class="btn btn-disabled"' : ''}>Approve Agency</button>
            </form>
            <form action="/admin/reject-agency" method="POST" style="margin:0;">
              <input type="hidden" name="id" value="${a.id}">
              <button type="submit" class="btn btn-reject">Reject / Delete</button>
            </form>
            <form action="/admin/pay-agency" method="POST" style="margin:0;">
              <input type="hidden" name="agencyId" value="${a.id}">
              <input type="hidden" name="amount" value="${a.wallet_balance_usd}">
              <button type="submit" class="btn btn-pay" ${a.wallet_balance_usd > 0 ? '' : 'disabled class="btn btn-disabled"'}>Payout USDT</button>
            </form>
          </td>
        </tr>
      `;
    });

    html += `
        </table>
      </div>

      <div class="card">
        <h2>👩‍🎤 Host Status & Anti-Hopping Verification</h2>
        <table>
          <tr><th>Host Profile</th><th>Belongs To</th><th>Status</th><th>Available Actions</th></tr>
    `;

    hostProfiles.forEach(h => {
      html += `
        <tr>
          <td><b>${h.username}</b><br><span style="color:#eab308;font-size:9px;">🪙 ${h.earned_coins_balance}</span></td>
          <td>${h.agency_name || 'Independent'}</td>
          <td>
            <span class="badge ${h.is_approved ? 'badge-active' : 'badge-pending'}">${h.is_approved ? 'Approved' : 'Pending'}</span><br>
            <span style="font-size:9px; color:#94a3b8;">${h.is_agency_locked ? '🔒 Locked' : '🔓 Unlocked'}</span>
          </td>
          <td class="actions-cell">
            <form action="/admin/approve-host" method="POST" style="margin:0;">
              <input type="hidden" name="id" value="${h.host_id}">
              <button type="submit" class="btn btn-approve" ${h.is_approved ? 'disabled class="btn btn-disabled"' : ''}>Approve Host</button>
            </form>
            <form action="/admin/reject-host" method="POST" style="margin:0;">
              <input type="hidden" name="id" value="${h.host_id}">
              <button type="submit" class="btn btn-reject">Reject Host</button>
            </form>
            <form action="/admin/toggle-host-lock" method="POST" style="margin:0;">
              <input type="hidden" name="id" value="${h.host_id}">
              <input type="hidden" name="currentLock" value="${h.is_agency_locked}">
              <button type="submit" class="btn btn-lock">${h.is_agency_locked ? 'Break Lock' : 'Clamp Lock'}</button>
            </form>
          </td>
        </tr>
      `;
    });

    html += `
        </table>
      </div>

      <div class="card">
        <h2>📜 Historical Financial Payout History</h2>
        <table>
          <tr><th>Disbursed To</th><th>Amount Cleared</th><th>Date Settled</th></tr>
    `;
    payrollLogs.forEach(p => {
      html += `<tr><td><b>${p.agency_name}</b></td><td style="color:#38bdf8; font-weight:bold;">$${p.amount_paid_usd}.00</td><td>${new Date(p.payment_date).toLocaleDateString()}</td></tr>`;
    });
    html += `</table></div></body></html>`;
    return res.send(html);
  } catch (err) { return res.status(500).send(`Dashboard View Failure: ${err.message}`); }
});

// ==========================================
// 3. OPERATIONAL POST ACTION ENGINES
// ==========================================
app.post('/admin/approve-agency', async (req, res) => {
  const { id, fallbackCode } = req.body;
  try {
    await sql`UPDATE agencies SET is_approved = TRUE, invite_code = ${fallbackCode} WHERE id = ${id}`;
    return res.redirect('/admin');
  } catch (err) { return res.status(500).send(err.message); }
});

app.post('/admin/reject-agency', async (req, res) => {
  try {
    await sql`DELETE FROM agencies WHERE id = ${req.body.id}`;
    return res.redirect('/admin');
  } catch (err) { return res.status(500).send(err.message); }
});

app.post('/admin/approve-host', async (req, res) => {
  try {
    await sql`UPDATE users SET is_approved = TRUE WHERE id = ${req.body.id}`;
    return res.redirect('/admin');
  } catch (err) { return res.status(500).send(err.message); }
});

app.post('/admin/reject-host', async (req, res) => {
  try {
    await sql`DELETE FROM users WHERE id = ${req.body.id}`;
    return res.redirect('/admin');
  } catch (err) { return res.status(500).send(err.message); }
});

app.post('/admin/toggle-host-lock', async (req, res) => {
  const { id, currentLock } = req.body;
  const targetLockState = !(currentLock === 'true' || currentLock === true);
  try {
    await sql`UPDATE host_profiles SET is_agency_locked = ${targetLockState} WHERE host_id = ${id}`;
    return res.redirect('/admin');
  } catch (err) { return res.status(500).send(err.message); }
});

app.post('/admin/pay-agency', async (req, res) => {
  const { agencyId, amount } = req.body;
  try {
    const payoutAmount = Math.floor(parseFloat(amount || 0));
    if (payoutAmount <= 0) return res.redirect('/admin');
    await sql`UPDATE agencies SET wallet_balance_usd = wallet_balance_usd - ${payoutAmount} WHERE id = ${agencyId}`;
    await sql`INSERT INTO agency_payroll (agency_id, amount_paid_usd) VALUES (${agencyId}, ${payoutAmount})`;
    return res.redirect('/admin');
  } catch (err) { return res.status(500).send(err.message); }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => { console.log(`Ecosystem online on ${PORT}`); });
