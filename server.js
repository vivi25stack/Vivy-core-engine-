require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto'); // Built-in Node module for signature checking
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

// 🟢 SECURED: Paystack Webhook Handler
app.post('/api/payments/paystack-webhook', async (req, res) => {
  try {
    // 1. Verify the Paystack Signature to ensure it actually came from Paystack
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY) // Ensure this is in your .env file
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.error("❌ UN-AUTHORIZED WEBHOOK ATTEMPT DETECTED!");
      return res.sendStatus(401); // Reject bad requests immediately
    }

    const event = req.body;
    console.log("🔒 Verified Paystack Event:", event.event);

    // 2. Only handle successful payments
    if (event.event === 'charge.success') {
      const { metadata, amount, reference } = event.data;
      const userId = metadata ? metadata.user_id : null;
      
      if (!userId) {
        console.error("❌ Webhook received but no user_id found in metadata.");
        return res.sendStatus(200);
      }

      await pool.query('BEGIN');

      // 3. Prevent duplicate crediting (Idempotency Check)
      // Checks if this Paystack reference code was already processed
      const duplicateCheck = await pool.query(
        'SELECT id FROM coin_transactions WHERE reference = $1', 
        [reference]
      );

      if (duplicateCheck.rowCount > 0) {
        console.log(`⚠️ Transaction ${reference} already processed. Skipping.`);
        await pool.query('COMMIT');
        return res.sendStatus(200);
      }

      // 4. Convert Kobo to Coins safely
      const coinAmount = Math.floor(amount / 100); 

      // 5. Securely credit coins and record the transaction ledger
      await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [coinAmount, userId]);
      await pool.query(
        'INSERT INTO coin_transactions (user_id, amount_coins, payment_method, status, reference) VALUES ($1, $2, $3, $4, $5)',
        [userId, coinAmount, 'paystack', 'completed', reference]
      );

      await pool.query('COMMIT');
      console.log(`✅ Real Cash Confirmed. Credited ${coinAmount} coins to user ${userId}`);
    }

  } catch (dbErr) {
    if (pool) await pool.query('ROLLBACK');
    console.error('Database webhook update failed:', dbErr);
    return res.sendStatus(500); // Let paystack know to try again later because server errored out
  }

  // Always return 200 OK to verified Paystack triggers
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
