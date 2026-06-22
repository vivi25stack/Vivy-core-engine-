const express = require('express');
const http = require('http');
const { neon } = require('@neondatabase/serverless');

const app = express();
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

// Establish Serverless Connection to Neon
const sql = neon(process.env.DATABASE_URL);
const server = http.createServer(app);

// ECOSYSTEM PARAMETERS ($1.00 USD = 1,000 COINS)
const HOST_MINIMUM_COINS = 10000; 
const COIN_TO_USD_VALUE = 0.001;  
const DEDUCTION_PER_30_SECONDS = 250; 

// ==========================================
// 1. ENDPOINT: MOBILE HOST ONBOARDING VIA AGENCY CODE
// ==========================================
app.post('/api/register/host', async (req, res) => {
  const { username, email, inviteCode } = req.body;

  if (!username || !email || !inviteCode) {
    return res.status(400).json({ error: "Missing required fields: username, email, or inviteCode." });
  }

  try {
    // Locate the matching, approved agency handling this link code
    const agency = await sql`SELECT id, agency_name FROM agencies WHERE invite_code = ${inviteCode} AND is_approved = TRUE`;
    
    if (!agency[0]) {
      return res.status(400).json({ error: "Invalid registration path. Invitation code is wrong or unapproved." });
    }

    // Insert user credentials into database (Starts unapproved until manual review)
    const userResult = await sql`
      INSERT INTO users (username, email, role, is_approved) 
      VALUES (${username}, ${email}, 'host', FALSE) 
      RETURNING id, username
    `;
    const newHost = userResult[0];

    // Establish profile and strictly lock the host to the agency
    await sql`
      INSERT INTO host_profiles (host_id, agency_id, earned_coins_balance, is_agency_locked) 
      VALUES (${newHost.id}, ${agency[0].id}, 0, TRUE)
    `;

    return res.json({ 
      message: "Host registration logged successfully!", 
      hostId: newHost.id,
      assignedAgency: agency[0].agency_name,
      status: "Pending Admin Approval" 
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. ENDPOINT: STANDARD USER REGISTRATION
// ==========================================
app.post('/api/register/user', async (req, res) => {
  const { username, email } = req.body;
  try {
    const newUser = await sql`
      INSERT INTO users (username, email, role, coin_balance, is_approved) 
      VALUES (${username}, ${email}, 'user', 1000, TRUE) 
      RETURNING id, username, coin_balance
    `;
    return res.json({ message: "User account created!", profile: newUser[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. ENDPOINT: AGENCY APPLICATION SUBMISSION
// ==========================================
app.post('/api/register/agency', async (req, res) => {
  const { agencyName, ownerName, commissionRate, usdtAddress } = req.body;
  try {
    const newAgency = await sql`
      INSERT INTO agencies (agency_name, owner_name, commission_rate, usdt_wallet_address, is_approved) 
      VALUES (${agencyName}, ${ownerName}, ${commissionRate}, ${usdtAddress}, FALSE) 
      RETURNING id, agency_name
    `;
    return res.json({ message: "Agency pending approval.", agency: newAgency[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. PORTAL: ADMIN SECURITY & GOVERNANCE VIEW
// ==========================================
app.get('/admin', async (req, res) => {
  try {
    const agencies = await sql`SELECT id, agency_name, owner_name, commission_rate, invite_code, is_approved FROM agencies ORDER BY id DESC`;
    const hostProfiles = await sql`
      SELECT hp.host_id, u.username, hp.earned_coins_balance, a.agency_name, hp.is_agency_locked, u.is_approved
      FROM host_profiles hp
      JOIN users u ON hp.host_id = u.id
      LEFT JOIN agencies a ON hp.agency_id = a.id
      ORDER BY u.id DESC
    `;

    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Vivy Control Center</title>
      <style>
        body { font-family: -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 12px; margin: 0; }
        h1 { color: #38bdf8; font-size: 20px; text-align: center; margin-bottom: 15px; }
        .card { background: #1e293b; padding: 12px; border-radius: 8px; margin-bottom: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); }
        h2 { font-size: 14px; margin-top: 0; color: #f472b6; border-bottom: 1px solid #334155; padding-bottom: 5px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { text-align: left; padding: 6px; border-bottom: 1px solid #334155; }
        th { color: #94a3b8; }
        .btn-approve { background: #eab308; color: #0f172a; border: none; padding: 3px 6px; border-radius: 4px; font-weight: bold; font-size: 10px; cursor: pointer; }
        .btn-unlock { background: #ef4444; color: white; border: none; padding: 3px 6px; border-radius: 4px; font-size: 10px; cursor: pointer; }
        .btn-lock { background: #22c55e; color: white; border: none; padding: 3px 6px; border-radius: 4px; font-size: 10px; cursor: pointer; }
        .status-ok { color: #22c55e; font-weight: bold; }
        .status-wait { color: #ef4444; font-weight: bold; }
        code { background: #0f172a; padding: 2px 4px; border-radius: 4px; color: #38bdf8; font-size: 11px; }
      </style>
    </head>
    <body>
      <h1>📱 Vivy Management Infrastructure</h1>

      <!-- AGENCY REGISTRATION WORKSPACE -->
      <div class="card">
        <h2>🏢 Agencies & Live Onboarding Codes</h2>
        <table>
          <tr><th>Agency</th><th>Onboarding Code & Path</th><th>Status</th><th>Action</th></tr>
    `;

    agencies.forEach(a => {
      const generatedCode = a.invite_code || `VIVY-${a.id}99`;
      html += `
        <tr>
          <td><b>${a.agency_name}</b><br><span style="color:#94a3b8;font-size:9px;">Owner: ${a.owner_name}</span></td>
          <td>
            <code>${generatedCode}</code><br>
            <span style="font-size:9px; color:#64748b;">Path: /register/host?code=${generatedCode}</span>
          </td>
          <td><span class="${a.is_approved ? 'status-ok' : 'status-wait'}">${a.is_approved ? 'Active' : 'Pending'}</span></td>
          <td>
            ${!a.is_approved ? `
              <form action="/admin/approve-agency" method="POST" style="margin:0;">
                <input type="hidden" name="id" value="${a.id}">
                <input type="hidden" name="fallbackCode" value="${generatedCode}">
                <button type="submit" class="btn-approve">Approve & Issue Code</button>
              </form>
            ` : `<span class="status-ok">Verified</span>`}
          </td>
        </tr>
      `;
    });

    html += `
        </table>
      </div>

      <!-- HOST ANTI-HOPPING VERIFICATION -->
      <div class="card">
        <h2>👩‍🎤 Host Verification & Security Locking</h2>
        <table>
          <tr><th>Host Creator</th><th>Assigned Agency</th><th>Lock Status</th><th>Action</th></tr>
    `;

    hostProfiles.forEach(h => {
      html += `
        <tr>
          <td><b>${h.username}</b> <br><span style="color:#94a3b8;font-size:9px;">Coins: ${h.earned_coins_balance}</span></td>
          <td>${h.agency_name || 'Independent / None'}</td>
          <td><span class="${h.is_agency_locked ? 'status-ok' : 'status-wait'}">${h.is_agency_locked ? '🔒 Strict Lock' : '🔓 Unlocked'}</span></td>
          <td>
            ${!h.is_approved ? `
              <form action="/admin/approve-host" method="POST" style="margin:0;">
                <input type="hidden" name="id" value="${h.host_id}">
                <button type="submit" class="btn-approve">Approve Host</button>
              </form>
            ` : `
              <form action="/admin/toggle-host-lock" method="POST" style="margin:0;">
                <input type="hidden" name="id" value="${h.host_id}">
                <input type="hidden" name="currentLock" value="${h.is_agency_locked}">
                <button type="submit" class="${h.is_agency_locked ? 'btn-unlock' : 'btn-lock'}">
                  ${h.is_agency_locked ? 'Unlock Host' : 'Activate Lock'}
                </button>
              </form>
            `}
          </td>
        </tr>
      `;
    });

    html += `</table></div></body></html>`;
    return res.send(html);
  } catch (err) {
    return res.status(500).send(`Dashboard View Failure: ${err.message}`);
  }
});

// ==========================================
// 5. POST-BACK ADMIN WORKERS
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

// ==========================================
// 6. ENGINES: CALL TIMERS & FINANCIAL BALANCING
// ==========================================
app.post('/simulate-call', async (req, res) => {
  const { userId, hostId } = req.body;
  
  try {
    const checkHost = await sql`SELECT is_approved FROM users WHERE id = ${hostId}`;
    if (!checkHost[0] || !checkHost[0].is_approved) {
      return res.status(403).json({ error: "Call blocked. Host account is unapproved." });
    }
  } catch(err) { return res.status(500).json({ error: err.message }); }

  res.json({ status: "Call connected successfully", billing: "250 coins / 30 seconds" });

  let callTimer = setInterval(async () => {
    try {
      const userRes = await sql`SELECT coin_balance FROM users WHERE id = ${userId}`;
      
      if (!userRes[0] || userRes[0].coin_balance < DEDUCTION_PER_30_SECONDS) {
        clearInterval(callTimer);
        console.log(`Call tracking dropped. User ${userId} ran out of coins.`);
        return;
      }

      // Concurrently transfer the specific coin amount down to the exact 30-second mark
      await sql`UPDATE users SET coin_balance = coin_balance - ${DEDUCTION_PER_30_SECONDS} WHERE id = ${userId}`;
      await sql`UPDATE host_profiles SET earned_coins_balance = earned_coins_balance + ${DEDUCTION_PER_30_SECONDS} WHERE host_id = ${hostId}`;
      
    } catch (err) { 
      clearInterval(callTimer); 
    }
  }, 30000); 
});

// WEEKLY SETTLEMENT WORKER
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

    return res.json({ success: true, processed: eligibleHosts.length });
  } catch (err) { 
    return res.status(500).json({ error: err.message }); 
  }
});

// SYSTEM HEALTH PROBE
app.get('/health', async (req, res) => {
  try {
    const result = await sql`SELECT NOW()`;
    return res.json({ status: "Vivy Engine Online!", dbTime: result[0].now });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Production engine deployment listening on port ${PORT}`);
});
