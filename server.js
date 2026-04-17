const express = require('express');
const { Pool } = require('pg');
const admin = require('firebase-admin');
require('dotenv').config();
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 1. PostgreSQL Connection (SSL Update ke saath)
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: false // Ye Render ke liye zaroori hai
    }
});

// 2. Firebase Setup (Keep this if you use it later)
try {
    const serviceAccount = require("./serviceAccountKey.json");
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
} catch (e) {
    console.log("Firebase key missing, skipping...");
}

// 3. Test Route
app.get('/', (req, res) => {
    res.send('🚀 AuraCRM School Backend is LIVE and Fresh!');
});

// 4. SMART API: Add Lead + Auto Fee Initialization (Phase 1 Finish)
app.post('/api/add-lead', async (req, res) => {
    const { student_name, parent_phone, source } = req.body;

    // --- 🧠 AI Smart Scoring Logic ---
    let aiScore = 50;
    if (student_name && student_name.length > 3) aiScore += 10;
    if (parent_phone && parent_phone.length === 10) aiScore += 15;
    if (source === 'Indore' || source === 'Ujjain') aiScore += 15;

    let suggestion = aiScore >= 80 ? "Immediate Call Required! 📞" : "Send WhatsApp Brochure 📄";

    try {
        // Step 1: Insert into Leads
        const result = await pool.query(
            "INSERT INTO leads (student_name, parent_phone, source, lead_score, status) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [student_name, parent_phone, source || 'Direct', aiScore, 'new']
        );

        const newLead = result.rows[0];

        // Step 2: IMPORTANT - Insert into student_fees immediately
        // Iske bina dashboard crash ho raha tha
        await pool.query(
            "INSERT INTO student_fees (lead_id, total_fees, paid_amount) VALUES ($1, $2, $3)",
            [newLead.id, 50000, 0]
        );

        res.status(201).json({
            message: "Lead Captured! 🔥",
            suggestion: suggestion,
            data: newLead
        });
    } catch (err) {
        console.error("Error adding lead:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 5. GET ALL LEADS: Joining Leads and Fees
app.get('/api/leads', async (req, res) => {
    try {
        const allData = await pool.query(`
      SELECT 
        l.*, 
        COALESCE(f.total_fees, 50000) as total_fees, 
        COALESCE(f.paid_amount, 0) as paid_amount,
        CASE 
          WHEN l.lead_score >= 80 AND l.status = 'new' THEN '🔥 High Priority: Call Immediately!'
          WHEN l.lead_score >= 60 AND l.status = 'new' THEN '✉️ Send WhatsApp Brochure'
          WHEN l.status = 'converted' AND (f.total_fees - f.paid_amount) > 0 THEN '💰 Pending Fees: Send Reminder'
          ELSE '✅ Everything looks good'
        END as next_action
      FROM leads l 
      LEFT JOIN student_fees f ON l.id = f.lead_id 
      ORDER BY l.id DESC
    `);
        res.json(allData.rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 6. UPDATE STATUS API
app.post('/api/update-status', async (req, res) => {
    const { id, newStatus } = req.body;
    try {
        await pool.query("UPDATE leads SET status = $1 WHERE id = $2", [newStatus, id]);
        res.json({ message: "Status Updated! ✅" });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 7. DELETE LEAD API
app.get('/api/delete-lead/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM leads WHERE id = $1", [id]);
        res.json({ message: "Lead deleted! 🗑️" });
    } catch (err) {
        res.status(500).send(err.message);
    }
});
// --- YAHAN PUSH KARO ---
app.post('/api/pay-fees', async (req, res) => {
    const { lead_id, amount } = req.body;
    try {
        await pool.query(
            "UPDATE student_fees SET paid_amount = paid_amount + $1 WHERE lead_id = $2",
            [amount, lead_id]
        );
        res.json({ message: "Paisa Vasool! 💰" });
    } catch (err) {
        res.status(500).send(err.message);
    }
});
const PORT = process.env.PORT || 5000;

// Sirf ye ek block rakho:
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ AuraCRM School Server started on port ${PORT}`);
    console.log(`🔗 Local access: http://localhost:${PORT}`);
    console.log(`📱 Mobile access: http://YOUR_LAPTOP_IP:${PORT}`);
});
// 🛠️ JUGAD: Tables banane ke liye temporary route
app.get('/setup-db', async (req, res) => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS leads (
                id SERIAL PRIMARY KEY,
                student_name TEXT,
                parent_phone TEXT,
                source TEXT,
                lead_score INTEGER,
                status TEXT DEFAULT 'new'
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS student_fees (
                id SERIAL PRIMARY KEY,
                lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
                total_fees INTEGER DEFAULT 50000,
                paid_amount INTEGER DEFAULT 0
            );
        `);
        res.send("✅ Tables Created Successfully!");
    } catch (err) {
        res.status(500).send("❌ Error: " + err.message);
    }
});