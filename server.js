require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Base Route
app.get('/', (req, res) => {
  res.json({ status: "online", platform: "Vivy Core Engine" });
});

// 🟢 NEW: Paystack Webhook Handler (Makes the URL Valid for Paystack!)
app.post('/api/payments/paystack-webhook', async (req, res) => {
  // Paystack pings this to test if the URL works
  const event = req.body;
  
  console.log("Paystack Webhook received event:", event.event);

  // If it's a successful payment event, process it
  if (event.event === 'charge.success') {
    const { metadata, amount } = event.data;
    // metadata will contain the userId passed during checkout
    const userId = metadata ? metadata.user_id : null;
    
    if (userId) {
      try {
        const coinAmount = Math.floor(amount / 100); // Convert Kobo to Coins/Naira equivalent
        
        await pool.query('BEGIN');
        await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [coinAmount, userId]);
        await pool.query(
          'INSERT INTO coin_transactions (user_id, amount_coins, payment_method, status) VALUES ($1, $2, $3, $4)',
          [userId, coinAmount, 'paystack', 'completed']
        );
        await pool.query('COMMIT');
        console.log(`Successfully credited ${coinAmount} coins to user ${userId}`);
      } catch (dbErr) {
        await pool.query('ROLLBACK');
        console.error('Database webhook update failed:', dbErr);
      }
    }
  }

  // ALWAYS respond with a 200 OK so Paystack knows the server is alive!
  res.sendStatus(200);
});

// Update Presence & Profile Avatar
app.post('/api/user/update-profile', async (req, res) => {
  const { userId, avatarUrl, isOnline, isStreaming, agencyCode } = req.body;
  try {
    await pool.query(
      `UPDATE users 
       SET avatar_url = COALESCE($1, avatar_url), 
           is_online = COALESCE($2, is_online), 
           is_streaming = COALESCE($3, is_streaming),
           agency_code = COALESCE($4, agency_code)
       WHERE id = $5`,
      [avatarUrl, isOnline, isStreaming, agencyCode, userId]
    );
    res.json({ success: true, message: "Profile tracking properties modified successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Active Hosts Registry
app.get('/api/hosts/active', async (req, res) => {
  try {
    const activeHosts = await pool.query(
      `SELECT id, username, avatar_url, is_streaming, coins 
       FROM users 
       WHERE role = 'host' AND is_online = true`
    );
    res.json(activeHosts.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agency Dashboard Settings
app.get('/api/agency/:code/hosts', async (req, res) => {
  try {
    const managedHosts = await pool.query(
      `SELECT id, username, avatar_url, is_online, is_streaming, coins as total_earned_coins
       FROM users 
       WHERE agency_code = $1 AND role = 'host'`,
      [req.params.code]
    );
    res.json({
      agencyCode: req.params.code,
      totalHostsCount: managedHosts.rowCount,
      hosts: managedHosts.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Vivy Server Engine Active On Port ${PORT}`));
