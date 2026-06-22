require("dotenv").config();
const http = require("http");
const { neon } = require("@neondatabase/serverless");

// Connects to your cloud database using your secure link key
const sql = neon(process.env.DATABASE_URL);

const requestHandler = async (req, res) => {
  const { method, url } = req;

  // Set response headers to return JSON text back safely
  res.writeHead(200, { "Content-Type": "application/json" });

  // 1. HEALTH MONITOR CHECK (GET /health)
  if (method === "GET" && url === "/health") {
    try {
      const result = await sql`SELECT NOW()`;
      const time = result[0].now;
      return res.end(JSON.stringify({ status: "Vivy Engine Active!", dbTime: time }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "Database connection failed", error: err.message }));
    }
  }

  // 2. CREATING A TEST PROFILE SHORTCUT (POST /test-setup)
  if (method === "POST" && url === "/test-setup") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { username, email, role } = JSON.parse(body);
        
        // Inserts profile with 100 free test credits using clean template literals
        const userResult = await sql`
          INSERT INTO users (username, email, role, coin_balance) 
          VALUES (${username}, ${email}, ${role}, 100) 
          RETURNING *
        `;
        
        const newUser = userResult[0];

        if (role === "host") {
          await sql`
            INSERT INTO host_profiles (host_id, cost_per_30_seconds) 
            VALUES (${newUser.id}, 25)
          `;
        }

        return res.end(JSON.stringify({ message: "Vivy test account created!", user: newUser }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 3. THE 30-SECOND RECURRING WALLET LOOP (POST /simulate-call)
  if (method === "POST" && url === "/simulate-call") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { userId, hostId } = JSON.parse(body);
        
        res.end(JSON.stringify({ message: "Vivy call streaming links active. Withdrawing balances every 30s." }));

        // Start our core 30-second stopwatch loop on the server background
        let callTimer = setInterval(async () => {
          try {
            const userRes = await sql`SELECT coin_balance FROM users WHERE id = ${userId}`;
            const hostRes = await sql`SELECT cost_per_30_seconds FROM host_profiles WHERE host_id = ${hostId}`;
            
            const currentCoins = userRes[0].coin_balance;
            const rate = hostRes[0].cost_per_30_seconds;

            // Safety limit check
            if (currentCoins < rate) {
              console.log(`[VIVY SYSTEM] User balance reached limit. Connection closed.`);
              clearInterval(callTimer);
              return;
            }

            // Deduct and credit wallets simultaneously
            await sql`UPDATE users SET coin_balance = coin_balance - ${rate} WHERE id = ${userId}`;
            await sql`UPDATE users SET coin_balance = coin_balance + ${rate} WHERE id = ${hostId}`;
            
            console.log(`[VIVY 30s TICK] Moved ${rate} coins. Remaining User Balance: ${currentCoins - rate}`);
          } catch (err) {
            console.log("Billing system loop break error:", err.message);
            clearInterval(callTimer);
          }
        }, 30000); // 30,000 milliseconds = 30 seconds

      } catch (err) {
        console.log("Error starting call:", err.message);
      }
    });
    return;
  }

  // Route fallback if wrong link is hit
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Route not found" }));
};

const PORT = process.env.PORT || 3000;
http.createServer(requestHandler).listen(PORT, () => {
  console.log(`Vivy cloud engine running live on port ${PORT}`);
});
