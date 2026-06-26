require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Paystack rates configuration constants
const COIN_PRICE_USD = 0.02; // $0.02 per single coin ($10 = 500 coins)

// Express body parser json engine
app.use(express.json());

// =========================================================================
// 1. INITIALIZE TRANSACTION: Requesting token authorization from Backend
// =========================================================================
app.post('/api/payments/initialize', async (req, res) => {
    const { userId, amountUsd } = req.body;
    
    try {
        const userQuery = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
        if (userQuery.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const userEmail = userQuery.rows[0].email;

        const reference = `vivy_${crypto.randomBytes(8).toString('hex')}`;
        const coinsToCredit = Math.floor(amountUsd / COIN_PRICE_USD);

        // Record initial pending intent state inside database
        await pool.query(
            'INSERT INTO transactions (user_id, reference, amount_usd, coins_credited, status) VALUES ($1, $2, $3, $4, \'pending\')',
            [userId, reference, amountUsd, coinsToCredit]
        );

        // Fetch initialization access_code directly via Paystack Engine
        const response = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: userEmail,
                amount: Math.round(amountUsd * 100), // Convert to base cents
                currency: 'USD',
                reference: reference
            })
        });

        const paystackData = await response.json();
        if (!paystackData.status) return res.status(400).json({ error: paystackData.message });

        // Pass authorization metadata down to your Flutter application layer
        res.json({
            accessCode: paystackData.data.access_code,
            reference: reference
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// =========================================================================
// 2. CRYPTOGRAPHIC WEBHOOK ROUTE: Delivers coins asynchronously 
// =========================================================================
app.post('/api/payments/paystack-webhook', async (req, res) => {
    const signature = req.headers['x-paystack-signature'];
    
    // Compute HMAC hash using local secret key signature validation loop
    const hash = crypto
        .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
        .update(JSON.stringify(req.body))
        .digest('hex');

    if (hash !== signature) {
        return res.status(401).send('Invalid Signature context.');
    }

    const event = req.body;
    if (event.event === 'charge.success') {
        const { reference, amount } = event.data;
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const txCheck = await client.query('SELECT * FROM transactions WHERE reference = $1', [reference]);
            if (txCheck.rows.length === 0) throw new Error('Transaction record mismatch');
            
            const transaction = txCheck.rows[0];

            if (transaction.status === 'pending') {
                // Safely update specific transaction context state
                await client.query('UPDATE transactions SET status = \'successful\' WHERE reference = $1', [reference]);

                // Increment verified coin assets inside client profile balance ledger
                await client.query(
                    'UPDATE users SET coin_balance = coin_balance + $1 WHERE id = $2',
                    [transaction.coins_credited, transaction.user_id]
                );
                
                await client.query('COMMIT');
                console.log(`Successfully credited ${transaction.coins_credited} coins to User: ${transaction.user_id}`);
            } else {
                await client.query('ROLLBACK');
            }
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Webhook execution failure runtime exception:', error);
        } finally {
            client.release();
        }
    }
    // Always return 200 OK to stop Paystack from resending the hook
    res.status(200).send('Event captured.');
});

// =========================================================================
// 3. STREAM HEARTBEAT LOOP: 30-Second dynamic deduction engine
// =========================================================================
app.post('/api/stream/heartbeat', async (req, res) => {
    const { userId, hostId, roomId, costPerHeartbeat } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verify user balances can sustain next billing cycle requirement
        const userQuery = await client.query('SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
        if (userQuery.rows.length === 0) throw new Error('User missing');
        
        const currentBalance = userQuery.rows[0].coin_balance;

        if (currentBalance < costPerHeartbeat) {
            await client.query('COMMIT');
            // Notify frontend to fire ZEGOCLOUD disconnect signal execution payload
            return res.json({ status: 'disconnect', reason: 'Insufficient balance' });
        }

        // Deduct coin assets from dynamic user record loop
        await client.query('UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2', [costPerHeartbeat, userId]);

        // Log session balance modification event trace tracking data
        await client.query(
            'INSERT INTO billing_sessions (user_id, host_id, zegocloud_room_id, total_coins_burned) ' +
            'VALUES ($1, $2, $3, $4) ON CONFLICT DO UPDATE SET total_coins_burned = billing_sessions.total_coins_burned + $4',
            [userId, hostId, roomId, costPerHeartbeat]
        );

        await client.query('COMMIT');
        res.json({ status: 'active', remainingBalance: currentBalance - costPerHeartbeat });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// =========================================================================
// 4. SUNDAY 5:00 PM SETTLEMENT AUTOMATION RUNTIME SCRIPT
// =========================================================================
app.post('/api/admin/trigger-weekly-settlement', async (req, res) => {
    const USDT_CONVERSION_RATE = 0.02; // Every coin earned maps to fractional USD revenue values
    
    try {
        // Query groups aggregate system coin balances across host and agency parameters
        const settlementQuery = await pool.query(`
            SELECT h.agency_id, SUM(bs.total_coins_burned) as total_earned
            FROM billing_sessions bs
            JOIN hosts h ON bs.host_id = h.id
            WHERE bs.is_active = true
            GROUP BY h.agency_id
        `);

        for (let row of settlementQuery.rows) {
            if (!row.agency_id) continue;
            
            const grossCoins = parseInt(row.total_earned);
            const totalUsdtPool = grossCoins * USDT_CONVERSION_RATE;
            
            // Execute exact application revenue allocations: 70% Host / 10% Agency commission structures
            const hostShareUsdt = totalUsdtPool * 0.70;
            const agencyShareUsdt = totalUsdtPool * 0.10;

            await pool.query(
                'INSERT INTO weekly_payout_batches (agency_id, gross_coins_earned, agency_share_usdt, host_share_usdt, batch_cutoff_date) ' +
                'VALUES ($1, $2, $3, $4, NOW())',
                [row.agency_id, grossCoins, agencyShareUsdt, hostShareUsdt]
            );
        }

        // Freeze calculated historical data segments to finalize accounting bounds
        await pool.query('UPDATE billing_sessions SET is_active = false WHERE is_active = true');

        res.json({ status: 'success', message: 'Sunday settlement ledger locked down successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => console.log('Vivy Server running on engine port 3000'));
