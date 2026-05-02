require("dotenv").config();
const Razorpay = require("razorpay");
const crypto = require("crypto");
const { Pool } = require("pg");

// ==========================
// 🗄️ DB CONNECTION
// ==========================
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// ==========================
// ⚡ RAZORPAY INSTANCE
// ==========================
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ==========================
// 🚀 CREATE SUBSCRIPTION (For School Plan)
// ==========================
const createSubscription = async (req, res) => {
    try {
        const { plan_id, school_id, total_count = 12 } = req.body; // total_count 12 matlab 12 mahine ka plan

        if (!plan_id || !school_id) {
            return res.status(400).json({ error: "Plan ID and School ID are required" });
        }

        const subscription = await razorpay.subscriptions.create({
            plan_id: plan_id,
            customer_notify: 1, // 1 matlab Razorpay direct customer ko email send karega
            total_count: total_count,
            notes: {
                school_id: school_id, // Extra data embed kar rahe hain for tracking
            },
        });

        // DB me initial entry save karenge
        await pool.query(
            `INSERT INTO subscriptions (razorpay_sub_id, school_id, status, plan_id) 
             VALUES ($1, $2, $3, $4)`,
            [subscription.id, school_id, subscription.status, plan_id]
        );

        res.status(200).json({
            success: true,
            subscription,
            // Frontend is short_url par redirect kar dega taaki payment gateway khul jaye
            redirect_url: subscription.short_url
        });
    } catch (error) {
        console.error("Subscription Creation Error:", error);
        res.status(500).json({ error: "Failed to create subscription" });
    }
};

// ==========================
// 🪝 RAZORPAY WEBHOOK HANDLER (Background Auto Update)
// ==========================
const handleWebhook = async (req, res) => {
    try {
        // Webhook Security: Signature Verify karna zaroori hai warna koi fake hit kar sakta hai
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const signature = req.headers["x-razorpay-signature"];

        // Body ko raw string me convert karna padta hai hash ke liye
        const body = JSON.stringify(req.body);

        const expectedSignature = crypto
            .createHmac("sha256", webhookSecret)
            .update(body)
            .digest("hex");

        if (expectedSignature !== signature) {
            console.error("⚠️ Webhook Signature Mismatch! Possible Hack Attempt.");
            return res.status(400).json({ error: "Invalid Signature" });
        }

        // Signature match ho gaya, ab event handle karo
        const event = req.body.event;
        const payload = req.body.payload.subscription.entity;
        const subId = payload.id;
        const schoolId = payload.notes?.school_id;

        console.log(`🔔 Webhook Event Received: ${event}`);

        // Switch case for different events
        switch (event) {
            case "subscription.activated":
                // Jab school ne pehla payment kar diya
                if (schoolId) {
                    await pool.query(
                        `UPDATE schools SET plan_status = 'active', plan_expiry = $1 WHERE id = $2`,
                        [new Date(payload.current_end * 1000), schoolId] // Unix timestamp to Date
                    );
                    await pool.query(
                        `UPDATE subscriptions SET status = 'active' WHERE razorpay_sub_id = $1`,
                        [subId]
                    );
                }
                break;

            case "subscription.completed":
                // Jab saare installments complete ho gaye (e.g. 12 mahine khatam)
                await pool.query(
                    `UPDATE subscriptions SET status = 'completed' WHERE razorpay_sub_id = $1`,
                    [subId]
                );
                if (schoolId) {
                    await pool.query(
                        `UPDATE schools SET plan_status = 'expired' WHERE id = $1`,
                        [schoolId]
                    );
                }
                break;

            case "subscription.paused":
            case "subscription.cancelled":
                // Agar school ne beech me plan cancel ya pause kar diya
                await pool.query(
                    `UPDATE subscriptions SET status = $1 WHERE razorpay_sub_id = $2`,
                    [event.includes("cancel") ? "cancelled" : "paused", subId]
                );
                if (schoolId) {
                    await pool.query(
                        `UPDATE schools SET plan_status = 'inactive' WHERE id = $1`,
                        [schoolId]
                    );
                }
                break;

            case "subscription.charged": // Har mahine jab payment cut hoti hai
                // Yahan aap payment receipt generation ya invoice mail logic add kar sakte ho
                break;

            default:
                console.log(`Unhandled Event: ${event}`);
        }

        // Razorpay ko hamesha 200 ok dena hai warna wo dobara baar baar webhook bhejta hai
        res.status(200).json({ status: "Webhook processed successfully" });

    } catch (error) {
        console.error("Webhook Processing Error:", error);
        res.status(500).json({ error: "Internal Webhook Error" });
    }
};

module.exports = { createSubscription, handleWebhook };