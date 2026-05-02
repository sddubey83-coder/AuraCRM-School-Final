const logger = require("./logger"); // Optional: Agar winston/morgan use karte ho

// ==========================
// 🚨 PRODUCTION ERROR HANDLER
// ==========================
const errorHandler = (err, req, res, next) => {
    // Default values set karo
    err.statusCode = err.statusCode || 500;
    err.status = err.status || "error";

    // Development me detailed error dikhao, Production me chhupa do
    if (process.env.NODE_ENV === "development") {
        res.status(err.statusCode).json({
            status: err.status,
            error: err,
            message: err.message,
            stack: err.stack
        });
    }
    // ==========================
    // 🏭 PRODUCTION LEVEL RESPONSE
    // ==========================
    else {
        // 1. PostgreSQL Unique Violation Error Handle (e.g., Duplicate Email)
        if (err.code === "23505") {
            const field = err.detail.match(/Key \((.*?)\)/)?.[1]; // Email nikaal lo error se
            return res.status(400).json({
                status: "fail",
                message: `Duplicate value entered for '${field}'. This record already exists.`
            });
        }

        // 2. JWT Errors alag se handle (though auth.js me handle kiya, double security)
        if (err.name === "JsonWebTokenError") {
            return res.status(401).json({ status: "fail", message: "Invalid Token" });
        }
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({ status: "fail", message: "Token Expired" });
        }

        // 3. Multer File Size Error Handle
        if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ status: "fail", message: "File too large. Max limit is 5MB." });
        }

        // 4. Operational / Trusted Errors (Jinhe hum khud throw karte hain)
        if (err.isOperational) {
            return res.status(err.statusCode).json({
                status: err.status,
                message: err.message
            });
        }

        // 5. Unknown Programming Errors (Client ko sirf generic message do)
        console.error("💥 UNHANDLED ERROR:", err);
        res.status(500).json({
            status: "error",
            message: "Something went very wrong on our end. Please try again later."
        });
    }
};

module.exports = errorHandler;