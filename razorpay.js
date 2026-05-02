require("dotenv").config();
const Razorpay = require("razorpay");
const crypto = require("crypto");
const { Pool } = require("pg");

// ==========================
// 🗄️ DB CONNECTION (Local instance for route)
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
// 🧾 CREATE ORDER
// ==========================
const createOrder = async (req, res) => {
    try {
        const { amount, currency = "INR", receipt, lead_id } = req.body;

        // Validations
        if (!amount || !lead_id) {
            return res.status(400).json({ error: "Amount and lead_id are required" });
        }

        const options = {
            amount: amount * 100, // Razorpay amount ko paise me maangta hai (e.g., 500 = 50000 paise)
            currency,
            receipt: receipt || `rcpt_${lead_id}_${Date.now()}`,
        };

        const order = await razorpay.orders.create(options);

        // DB me order track karne ke liye store karna (Best Practice)
        await pool.query(
            `INSERT INTO payment_orders (razorpay_order_id, lead_id, amount, status) 
             VALUES ($1, $2, $3, $4)`,
            [order.id, lead_id, amount, "created"]
        );

        res.status(200).json({
            success: true,
            order,
            key: process.env.RAZORPAY_KEY_ID, // Frontend ko payment capture karne ke liye ye chahiye
        });
    } catch (error) {
        console.error("Razorpay Order Error:", error);
        res.status(500).json({ error: "Could not create Razorpay order" });
    }
};

// ==========================
// ✅ VERIFY PAYMENT
// ==========================
const verifyPayment = async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            lead_id,
            amount
        } = req.body;

        // Missing data check
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ error: "Missing payment verification details" });
        }

        // Step 1: Server-side Signature Generation (Security Check)
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest("hex");

        // Step 2: Signature Match
        if (expectedSignature === razorpay_signature) {

            // Step 3: Update Payment Orders Table
            await pool.query(
                `UPDATE payment_orders 
                 SET razorpay_payment_id = $1, status = 'paid', signature = $2 
                 WHERE razorpay_order_id = $3`,
                [razorpay_payment_id, razorpay_signature, razorpay_order_id]
            );

            // Step 4: Automatically Update Fees Table (Jo aapne server.js me banaya tha)
            if (lead_id && amount) {
                await pool.query(
                    `UPDATE fees SET paid_amount = paid_amount + $1 WHERE lead_id = $2`,
                    [amount, lead_id]
                );
            }

            res.status(200).json({
                success: true,
                message: "Payment verified and fees updated successfully",
                paymentId: razorpay_payment_id
            });

        } else {
            // Tampered Payment
            res.status(400).json({ error: "Invalid Payment Signature (Tampered Data)" });
        }
    } catch (error) {
        console.error("Payment Verification Error:", error);
        res.status(500).json({ error: "Internal verification failed" });
    }
};

module.exports = { createOrder, verifyPayment };