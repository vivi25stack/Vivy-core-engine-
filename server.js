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

// Get Active Hosts Registry for Selection Grid
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

// Agency Dashboard: Managed Hosts Tracking Matrix
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

// RTC Signaling Stream Handshake Room Initializer
app.post('/api/calls/initiate', async (req, res) => {
  const { hostId, callerId } = req.body;
  const generatedRoomId = `room_${hostId}_${Date.now()}`;
  try {
    await pool.query(
      'INSERT INTO active_calls (host_id, caller_id, room_id, status) VALUES ($1, $2, $3, $4)',
      [hostId, callerId, generatedRoomId, 'connecting']
    );
    res.json({ success: true, roomId: generatedRoomId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Vivy Server Engine Active On Port ${PORT}`));
