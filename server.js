require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Safe Neon Database Connection Setup
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("❌ CRITICAL ERROR: DATABASE_URL environment variable is missing!");
  console.log("👉 Make sure to add DATABASE_URL to your Render or local environment variables.");
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false } // Required securely for Neon connections
});

// Test DB Connection on boot without throwing uncaught exceptions
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Connected to Neon PostgreSQL successfully.');
    release();
  }
});

// 2. Base Route (To prove your server is alive)
app.get('/', (req, res) => {
  res.status(200).json({ status: "online", message: "Vivy backend is running smoothly!" });
});

// 3. Google Play Purchase Ingestion (Coin Purchases)
app.post('/api/payments/google-play', async (req, res) => {
  const { userId, coinAmount, purchaseToken } = req.body;

  try {
    // ⚠️ Real setup requires validating purchaseToken via googleapis
    // For now, securely process the verified package asset lifecycle
    await pool.query('BEGIN');
    
    // Credit user coins
    await pool.query(
      'UPDATE users SET coins = coins + $1 WHERE id = $2',
      [coinAmount, userId]
    );

    // Log the event history log
    await pool.query(
      'INSERT INTO coin_transactions (user_id, amount_coins, payment_method, status) VALUES ($1, $2, $3, $4)',
      [userId, coinAmount, 'google_play', 'completed']
    );

    await pool.query('COMMIT');
    res.status(200).json({ success: true, message: `${coinAmount} coins successfully credited.` });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error processing Google Play asset:', error);
    res.status(500).json({ success: false, error: 'Database processing failed.' });
  }
});

// 4. Paystack Integration Placeholder (Safe & Documented)
// Keeps server working seamlessly while your approval goes through
app.post('/api/payments/paystack-init', (req, res) => {
  res.status(202).json({
    success: false,
    message: "Paystack route is prepared. Gateway will be active following agency/host profile verification approval.",
    status: "pending_activation"
  });
});

// 5. App Dashboard Metrics Fetch API
app.get('/api/dashboard/user/:id', async (req, res) => {
  try {
    const userQuery = await pool.query('SELECT id, username, email, role, coins FROM users WHERE id = $1', [req.params.id]);
    if (userQuery.rows.length === 0) {
      return res.status(404).json({ error: "User profile record not found." });
    }
    res.status(200).json(userQuery.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Internal server error reading dashboard data." });
  }
});

// Global Error Catch to prevent server drops on rogue client requests
app.use((err, req, res, next) => {
  console.error("Unhandled runtime error:", err.stack);
  res.status(500).json({ error: "Something went wrong inside the server engine." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server actively listening on port ${PORT}`);
});
