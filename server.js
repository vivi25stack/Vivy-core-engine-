require('dotenv').config();

const express = require('express');
const http = require('http');
const { neon } = require('@neondatabase/serverless');

const app = express();
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

// Serverless Neon Connection Pool
const sql = neon(process.env.DATABASE_URL);
const server = http.createServer(app);

// platform parameters ($1.00 USD = 1,000 COINS)
const HOST_MINIMUM_COINS = 10000; 
const COIN_TO_USD_VALUE = 0.001;  
const DEDUCTION_PER_30_SECONDS = 250; 

// ==========================================
// 1. ENDPOINT: HOST REGISTRATION VIA AGENCY CODE
// ==========================================
app.post('/api/register/host', async (req, res) => {
  const { username, email, inviteCode } = req.body;
  if (!username || !email || !inviteCode) {
    return res.status(400).json({ error: "Missing fields." });
  }
  try {
    const agency = await sql`SELECT id, agency_name FROM agencies WHERE invite_code = ${inviteCode} AND is_approved = TRUE`;
    if (!agency[0]) {
      return res.status(400).json({ error: "Invalid or unapproved agency code." });
    }
    const userResult = await sql`
      INSERT INTO users (username, email, role, is_approved) 
      VALUES (${username}, ${email}, 'host', FALSE) 
      RETURNING id
    `;
    await sql`
      INSERT INTO host_profiles (host_id, agency_id, earned_coins_balance, is_agency_locked) 
      VALUES (${userResult[0].id}, ${agency[0].id}, 0, TRUE)
    `;
    return res.json({ message: "Registered! Awaiting Admin Approval." });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ==========================================
// 2. CENTRAL MASTER MANAGEMENT ECOSYSTEM (ADMIN)
// ==========================================
app.get('/admin', async (req, res) => {
  try {
    // Pull full datasets directly from Neon
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
      <title>Vivy Master Command Center</title>
      <style>
        body { font-family: -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 12px; margin: 0; }
        h1 { color: #38bdf8; font-size: 20px; text-align: center; margin-bottom: 15px; }
        .card { background: #1e293b; padding: 12px; border-radius: 8px; margin-bottom: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); }
        h2 { font-size: 14px; margin-top: 0; color: #f472b6; border-bottom: 1px solid #334155; padding-bottom: 5px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { text-align: left; padding: 6px; border-bottom: 1px solid #334155; }
        th { color: #94a3b8; }
        .btn-pay { background: #22c55e; color: white; border: none; padding: 4px 6px; border-radius: 4px; font-weight: bold; font-size: 10px; cursor: pointer; }
        .btn-approve { background: #eab308; color: #0f172a; border: none; padding: 4px 6px; border-radius: 4px; font-weight: bold; font-size: 10px; cursor: pointer; }
        .btn-unlock { background: #ef4444; color: white; border: none; padding: 4px 6px; border-radius: 4px; font-size: 10px; cursor: pointer; }
        .btn-lock { background: #3b82f6; color: white; border: none; padding: 4px 6px; border-radius: 4px; font-size: 10px; cursor: pointer; }
        .status-ok { color: #22c55e; font-weight: bold; }
        .status-wait { color: #ef4444; font-weight: bold; }
        code { background: #0f172a; padding: 2px 4px; border-radius: 4px; color: #38bdf8; font-size: 11px; }
      </style>
    </head>
    <body>
      <h1>📱 Vivy Money & Operations Hub</h1>

      <div class="card">
        <h2>🏢 Agency Ledgers (USDT Settlements)</h2>
        <table>
          <tr><th>Agency Info</th><th>Wallet Destination</th><th>Accumulated Balance</th><th>Action Box</th></tr>
    `;

    agencies.forEach(a => {
      const generatedCode = a.invite_code || `VIVY-${a.id}99`;
      const walletAddress = a.usdt_wallet_address || 'None Configured';
      
      html += `
        <tr>
          <td>
            <b>${a.agency_name}</b><br>
            <span style="font-size:9px; color:#94a3b8;">Code: <code>${generatedCode}</code></span>
          </td>
          <td style="word-break:break-all; max-width:80px;"><code>${walletAddress}</code></td>
          <td style="color:#22c55e; font-weight:bold;">$${parseFloat(a.wallet_balance_usd || 0).toFixed(2)}</td>
          <td>
            ${!a.is_approved ? `
              <form action="/admin/approve-agency" method="POST" style="margin:0;">
                <input type="hidden" name="id" value="${a.id}">
                <input type="hidden" name="fallbackCode" value="${generatedCode}">
                <button type="submit" class="btn-approve">Approve & Open Link</button>
              </form>
            ` : `
              <form action="/admin/pay-agency" method="POST" style="margin:0;">
                <input type="hidden" name="agencyId" value="${a.id}">
                <input type="hidden" name="amount" value="${a.wallet_balance_usd}">
                <button type="submit" class="btn-pay" ${a.wallet_balance_usd > 0 ? '' : 'disabled style="background:#475569;"'}>Reset & Confirm Payout</button>
              </form>
            `}
          </td>
        </tr>
      `;
    });

    html += `
        </table>
      </div>

      <div class="card">
        <h2>👩‍🎤 Host Ecosystem & Anti-Hopping Locks</h2>
        <table>
          <tr><th>Host Account</th><th>Belongs To</th><th>Coin Pool</th><th>Contract Status</th></tr>
    `;

    hostProfiles.forEach(h => {
      html += `
        <tr>
          <td><b>${h.username}</b></td>
          <td>${h.agency_name || 'Independent'}</td>
          <td style="color:#eab308; font-weight:bold;">🪙 ${h.earned_coins_balance}</td>
          <td>
            ${!h.is_approved ? `
              <form action="/admin/approve-host" method="POST" style="margin:0;">
                <input type="hidden" name="id" value="${h.host_id}">
                <button type="submit" class="btn-approve">Approve Profile</button>
              </form>
            ` : `
              <form action="/admin/toggle-host-lock" method="POST" style="margin:0;">
                <input type="hidden" name="id" value="${h.host_id}">
                <input type="hidden" name="currentLock" value="${h.is_agency_locked}">
                <button type="submit" class="${h.is_agency_locked ? 'btn-unlock' : 'btn-lock'}">
                  ${h.is_agency_locked ? '🔓 Break Contract Lock' : '🔒 Secure Lock'}
                </button>
              </form>
            `}
          </td>
        </tr>
      `;
    });

    html += `
        </table>
      </div>

      <div class="card">
        <h2>📜 Historic Financial Payout History</h2>
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
// 3. POST ROUTES: FIRING CELL CLICK TRANSACTIONS
// ==========================================
app.post('/admin/approve-agency', async (req, res) => {
  const { id, fallbackCode } = req.body;
  try {
    await sql`UPDATE agencies SET is_approved = TRUE, invite_code = ${fallbackCode} WHERE id = ${id}`;
    return res.redirect('/admin');
  } catch (err) { return res.status(500).send(err.message); }
});

app.post('/admin/approve-host', async (req, res) => {
  try {
    await sql`UPDATE users SET is_approved = TRUE WHERE id = ${req.body.id}`;
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

    // Remove money from agency balance sheet wallet
    await sql`UPDATE agencies SET wallet_balance_usd = wallet_balance_usd - ${payoutAmount} WHERE id = ${agencyId}`;
    // Log record into the visual payroll log table
    await sql`INSERT INTO agency_payroll (agency_id, amount_paid_usd) VALUES (${agencyId}, ${payoutAmount})`;
    
    return res.redirect('/admin');
  } catch (err) { return res.status(500).send(err.message); }
});

// ==========================================
// 4. CALL TRACKER AND DISBURSEMENT SCHEDULER
// ==========================================
app.post('/simulate-call', async (req, res) => {
  const { userId, hostId } = req.body;
  try {
    const checkHost = await sql`SELECT is_approved FROM users WHERE id = ${hostId}`;
    if (!checkHost[0] || !checkHost[0].is_approved) {
      return res.status(403).json({ error: "Access Denied. Host unverified." });
    }
  } catch(err) { return res.status(500).json({ error: err.message }); }

  res.json({ message: "Vivy streaming pipeline active. 250 coin interval tracking on." });

  let callTimer = setInterval(async () => {
    try {
      const userRes = await sql`SELECT coin_balance FROM users WHERE id = ${userId}`;
      if (!userRes[0] || userRes[0].coin_balance < DEDUCTION_PER_30_SECONDS) {
        clearInterval(callTimer);
        return;
      }
      await sql`UPDATE users SET coin_balance = coin_balance - ${DEDUCTION_PER_30_SECONDS} WHERE id = ${userId}`;
      await sql`UPDATE host_profiles SET earned_coins_balance = earned_coins_balance + ${DEDUCTION_PER_30_SECONDS} WHERE host_id = ${hostId}`;
    } catch (err) { clearInterval(callTimer); }
  }, 30000); 
});

// SUNDAY RUN CRON TRIGGER
app.post('/api/cron/sunday-withdrawal', async (req, res) => {
  try {
    const eligibleHosts = await sql`
      SELECT hp.host_id, hp.earned_coins_balance, hp.agency_id 
      FROM host_profiles hp
      JOIN users u ON hp.host_id = u.id
      JOIN agencies a ON hp.agency_id = a.id
      WHERE hp.earned_coins_balance >= ${HOST_MINIMUM_COINS}
      AND u.is_approved = TRUE AND a.is_approved = TRUE
    `;
    for (let host of eligibleHosts) {
      const totalUSD = host.earned_coins_balance * COIN_TO_USD_VALUE;
      await sql`UPDATE agencies SET wallet_balance_usd = wallet_balance_usd + ${totalUSD} WHERE id = ${host.agency_id}`;
      await sql`UPDATE host_profiles SET earned_coins_balance = 0 WHERE host_id = ${host.host_id}`;
    }
    return res.json({ success: true, count: eligibleHosts.length });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get('/health', async (req, res) => {
  try {
    const result = await sql`SELECT NOW()`;
    return res.json({ status: "Vivy Engine Active!", dbTime: result[0].now });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => { console.log(`Ecosystem online on ${PORT}`); });
