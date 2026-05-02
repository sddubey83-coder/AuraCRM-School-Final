// ==========================================================
// 🛑 LINE 1: FORCE IPV4 (ETIMEDOUT IPv6 ERROR FIX)
// ==========================================================
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const app = express();

// ==========================
// 🛡️ CRASH-PROOF LOGIC
// ==========================
let authenticate = (req, res, next) => next();
let upload = { single: () => (req, res, next) => next() };
let errorHandler = (err, req, res, next) => res.status(500).json({ error: "Handler missing." });

try { const m = require("./middleware/auth"); if (m.authenticate) authenticate = m.authenticate; } catch (e) { }
try { const m = require("./middleware/upload"); if (m.single) upload = m; } catch (e) { }
try { const m = require("./middleware/errorHandler"); if (typeof m === 'function') errorHandler = m; } catch (e) { }

const safeRequire = (path) => { try { return require(path); } catch (e) { return null; } };

const studentRoutes = safeRequire("./students");
const feeRoutes = safeRequire("./fees");
const staffRoutes = safeRequire("./staff");
const examRoutes = safeRequire("./exams");
const payrollRoutes = safeRequire("./payroll");
const transportRoutes = safeRequire("./transport");
const analyticsRoutes = safeRequire("./analytics");
const razorpayRoutes = safeRequire("./razorpay");
const subscriptionRoutes = safeRequire("./subscription");

// ==========================
// 🔐 GLOBAL MIDDLEWARES
// ==========================
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json({ limit: '10kb' }));
app.use(helmet());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

// ==========================
// 🗄️ DB CONNECTION
// ==========================
const pool = require("./db");

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ==========================
// 🟢 HEALTH
// ==========================
app.get("/", (req, res) => res.send("🚀 AuraSync PRO Backend Running"));

// ==========================
// 🔐 AUTH ROUTES
// ==========================
app.post("/api/auth/register", asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Missing fields" });

    const existing = await pool.query("SELECT * FROM staff WHERE email=$1", [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: "User already exists" });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
        `INSERT INTO staff (name, email, role, pin_hash) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role`,
        [name || "Admin", email, "admin", hash]
    );
    res.status(201).json(result.rows[0]);
}));

app.post("/api/auth/login", asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await pool.query("SELECT * FROM staff WHERE email=$1", [email]);
    if (user.rows.length === 0) return res.status(401).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.rows[0].pin_hash);
    if (!valid) return res.status(401).json({ error: "Wrong password" });

    const payload = {
        id: user.rows[0].id,
        email: user.rows[0].email,
        role: user.rows[0].role,
        schoolId: user.rows[0].school_id || "1"
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "15m" });
    res.json({ token, user: payload });
}));

// ==========================
// 📱 WHATSAPP & MISC
// ==========================
app.post("/api/whatsapp/welcome", authenticate, asyncHandler(async (req, res) => {
    const { phone, studentName } = req.body;
    console.log(`Sending WhatsApp to ${phone}: Welcome ${studentName}`);
    res.json({ success: true, message: "Welcome message sent!" });
}));

// ==========================
// 🧠 LEADS
// ==========================
app.post("/api/leads", authenticate, asyncHandler(async (req, res) => {
    const { student_name, parent_phone, source } = req.body;
    if (!student_name || !parent_phone) return res.status(400).json({ error: "Invalid data" });

    const firebase_id = "lead_" + Date.now();
    await pool.query(
        `INSERT INTO leads (firebase_id, student_name, parent_phone, source, status, school_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [firebase_id, student_name, parent_phone, source || "Walk-in", "new", req.user.schoolId]
    );
    await pool.query(`INSERT INTO fees (lead_id, total_fees, paid_amount) VALUES ($1,$2,$3)`, [firebase_id, 50000, 0]);
    res.json({ firebase_id, student_name });
}));

app.get("/api/leads", authenticate, asyncHandler(async (req, res) => {
    const result = await pool.query(
        `SELECT l.*, f.total_fees, f.paid_amount, (f.total_fees - f.paid_amount) AS pending
         FROM leads l LEFT JOIN fees f ON l.firebase_id = f.lead_id
         WHERE l.school_id = $1 ORDER BY l.created_at DESC`, [req.user.schoolId]
    );
    res.json(result.rows);
}));

app.delete("/api/leads/:id", authenticate, asyncHandler(async (req, res) => {
    await pool.query("DELETE FROM leads WHERE firebase_id=$1", [req.params.id]);
    res.json({ message: "Deleted" });
}));

// ==========================
// 📣 CAMPAIGNS & MESSAGES
// ==========================
app.post("/api/campaigns", authenticate, asyncHandler(async (req, res) => {
    const { name, message_template } = req.body;
    const result = await pool.query(`INSERT INTO campaigns (name, message_template) VALUES ($1,$2) RETURNING *`, [name, message_template]);
    res.json(result.rows[0]);
}));

app.post("/api/campaigns/run/:id", authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const campaign = await pool.query("SELECT * FROM campaigns WHERE id=$1", [id]);
    if (!campaign.rows.length) return res.status(404).json({ error: "Campaign not found" });

    const leads = await pool.query("SELECT parent_phone FROM leads WHERE school_id=$1", [req.user.schoolId]);
    for (let lead of leads.rows) {
        await pool.query(`INSERT INTO message_logs (phone, message) VALUES ($1,$2)`, [lead.parent_phone, campaign.rows[0].message_template]);
    }
    await pool.query(`UPDATE campaigns SET sent_count=$1, status='completed' WHERE id=$2`, [leads.rows.length, id]);
    res.json({ sent: leads.rows.length });
}));

app.get("/api/messages", authenticate, asyncHandler(async (req, res) => {
    const result = await pool.query("SELECT * FROM message_logs ORDER BY sent_at DESC LIMIT 100");
    res.json(result.rows);
}));

// ==========================
// 🤖 AUTOMATION LOGS
// ==========================
app.post("/api/automation", authenticate, asyncHandler(async (req, res) => {
    const { flow_key, triggered_for } = req.body;
    await pool.query(`INSERT INTO automation_logs (flow_key, triggered_for) VALUES ($1,$2)`, [flow_key, triggered_for]);
    res.json({ message: "Logged" });
}));

// ==========================
// 📜 CERTIFICATES
// ==========================
app.get("/api/certificates/:id", authenticate, asyncHandler(async (req, res) => {
    const result = await pool.query(
        `SELECT l.student_name, l.parent_phone, f.paid_amount, f.total_fees
         FROM leads l LEFT JOIN fees f ON l.firebase_id = f.lead_id
         WHERE l.firebase_id = $1 AND l.school_id = $2`, [req.params.id, req.user.schoolId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Student not found" });
    res.json(result.rows[0]);
}));

// =====================================================================
// 🗂️ MODULAR ROUTES MOUNTING
// =====================================================================
if (studentRoutes) app.use("/api/students", authenticate, studentRoutes);
if (feeRoutes) app.use("/api/fees", authenticate, feeRoutes);
if (staffRoutes) app.use("/api/staff", authenticate, staffRoutes);
if (examRoutes) app.use("/api/exams", authenticate, examRoutes);
if (payrollRoutes) app.use("/api/payroll", authenticate, payrollRoutes);
if (transportRoutes) app.use("/api/transport", authenticate, transportRoutes);
if (analyticsRoutes) app.use("/api/analytics/app", authenticate, analyticsRoutes);

app.post("/api/fees/pay", authenticate, asyncHandler(async (req, res) => {
    await pool.query(`UPDATE fees SET paid_amount = paid_amount + $1 WHERE lead_id = $2`, [req.body.amount, req.body.lead_id]);
    res.json({ message: "Payment Success" });
}));

app.get("/api/analytics/students", authenticate, asyncHandler(async (req, res) => { const r = await pool.query(`SELECT * FROM v_student_full`); res.json(r.rows); }));
app.get("/api/analytics/revenue", authenticate, asyncHandler(async (req, res) => { const r = await pool.query(`SELECT * FROM v_revenue_by_branch`); res.json(r.rows); }));
app.get("/api/analytics/leads", authenticate, asyncHandler(async (req, res) => { const r = await pool.query(`SELECT * FROM v_lead_pipeline`); res.json(r.rows); }));
app.get("/api/analytics/risk", authenticate, asyncHandler(async (req, res) => { const r = await pool.query(`SELECT * FROM v_at_risk_students`); res.json(r.rows); }));

app.post("/api/attendance", authenticate, asyncHandler(async (req, res) => {
    await pool.query(`INSERT INTO attendance (student_id, present) VALUES ($1,$2) ON CONFLICT (student_id, date) DO UPDATE SET present=$2`, [req.body.student_id, req.body.present]);
    res.json({ message: "Saved" });
}));

// =====================================================================
// 💰 PAYMENT GATEWAYS
// =====================================================================
if (razorpayRoutes && razorpayRoutes.createOrder) app.post("/api/payment/order", authenticate, razorpayRoutes.createOrder);
if (razorpayRoutes && razorpayRoutes.verifyPayment) app.post("/api/payment/verify", razorpayRoutes.verifyPayment);
if (subscriptionRoutes && subscriptionRoutes.createSubscription) app.post("/api/subscription/create", authenticate, subscriptionRoutes.createSubscription);
if (subscriptionRoutes && subscriptionRoutes.handleWebhook) app.post("/api/subscription/webhook", subscriptionRoutes.handleWebhook);

// ==========================
// ❌ 404 NOT FOUND (EXPRESS 5 SAFE)
// ==========================
app.use((req, res, next) => {
    const error = new Error(`Can't find ${req.originalUrl} on this server!`);
    error.statusCode = 404;
    next(error);
});

// ==========================
// 🚨 GLOBAL ERROR HANDLER
// ==========================
app.use(errorHandler);

// ==========================
// 🚀 GRACEFUL START SERVER
// ==========================
const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        await pool.query("SELECT 1");
        console.log("✅ PostgreSQL Connected Successfully");

        const server = app.listen(PORT, () => {
            console.log(`🔥 AuraSync PRO running on port ${PORT} [${process.env.NODE_ENV || 'development'} MODE]`);
        });

        process.on('SIGTERM', () => { console.log('👋 Shutting down gracefully'); server.close(() => process.exit(0)); });
        process.on('SIGINT', () => { console.log('👋 Shutting down gracefully'); server.close(() => process.exit(0)); });

    } catch (error) {
        console.error("❌ FATAL ERROR: Could not connect to Database!");
        console.error("DETAILS:", error.message);
        process.exit(1);
    }
};

startServer();