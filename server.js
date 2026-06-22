const express = require('express');
const http = require('http');
const { neon } = require('@neondatabase/serverless');

const app = express();
app.use(express.json()); 

const sql = neon(process.env.DATABASE_URL);
const server = http.createServer(app);

// 1. HEALTH CHECKS
app.get('/health', async (req, res) => {
  try {
    const result = await sql`SELECT NOW()`;
    return res.json({ status: "Vivy Engine Active!", dbTime: result[0].now });
  } catch (err) {
    return res.status(500).json({ error: "Database not connected", details: err.message });
  }
});

// 2. MOCK TESTING PROVISIONS
app.post('/test-setup', async (req, res) => {
  const { username, email, role } = req.body;
  try {
    const userResult = await sql`
      INSERT INTO users (username, email, role, coin_balance) 
      VALUES (${username}, ${email}, ${role}, 100) 
      RETURNING *
    `;
    const newUser = userResult[0];

    if (role === 'host') {
      await sql`
        INSERT INTO host_profiles (host_id, cost_per_30_seconds) 
        VALUES (${newUser.id}, 25)
      `;
    }
    return res.json({ message: "Vivy profile established!", user: newUser });
  } catch (err) {
    // Added return here to prevent double response crashes
    return res.status(500).json({ error: err.message });
  }
});

// 3. THE 30-SECOND BALANCE WITHDRAWAL LOOP
app.post('/simulate-call', async (req, res) => {
  const { userId, hostId } = req.body;
  
  // Send response immediately to free up the app interface
  res.json({ message: "Vivy loop active. Balance tracking running in background." });

  let callTimer = setInterval(async () => {
    try {
      const userRes = await sql`SELECT coin_balance FROM users WHERE id = ${userId}`;
      const hostRes = await sql`SELECT cost_per_30_seconds FROM host_profiles WHERE host_id = ${hostId}`;
      
      // Safety check in case database records are missing
      if (!userRes[0] || !hostRes[0]) {
        console.log(`[VIVY SYSTEM] Profiles not found. Ending loop.`);
        clearInterval(callTimer);
        return;
      }

      const currentCoins = userRes[0].coin_balance;
      const rate = hostRes[0].cost_per_30_seconds;

      if (currentCoins < rate) {
        console.log(`[VIVY CONNECTION CLOSED] User balance is low.`);
        clearInterval(callTimer);
        return;
      }

      // Execute coin swap in database
      await sql`UPDATE users SET coin_balance = coin_balance - ${rate} WHERE id = ${userId}`;
      await sql`UPDATE users SET coin_balance = coin_balance + ${rate} WHERE id = ${hostId}`;
      
      console.log(`[30s WITHDRAWAL] Transferred ${rate} coins. User balance remaining: ${currentCoins - rate}`);
    } catch (err) {
      console.log("Loop runtime error encountered:", err.message);
      clearInterval(callTimer);
    }
  }, 30000); 
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Vivy production core active on port ${PORT}`);
});
