const jwt = require("jsonwebtoken");

// ==========================
// 🔐 AUTHENTICATE MIDDLEWARE
// ==========================
const authenticate = (req, res, next) => {
    try {
        // 1. Header se token nikaalo (Bearer <token>)
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                error: "You are not logged in! Please log in to get access."
            });
        }

        // 2. Bearer hata ke sirf token lo
        const token = authHeader.split(" ")[1];

        // 3. Token verify karo
        const decodedPayload = jwt.verify(token, process.env.JWT_SECRET);

        // 4. User data req me daal do (Aage ke routes me iska use hoga)
        req.user = {
            id: decodedPayload.id,
            email: decodedPayload.email,
            role: decodedPayload.role,
            schoolId: decodedPayload.schoolId
        };

        next(); // Next middleware ya route pe jao
    } catch (error) {
        // Pro Level: Alag alag JWT errors ko alag message do
        if (error.name === "JsonWebTokenError") {
            return res.status(401).json({ success: false, error: "Invalid token. Please log in again." });
        }
        if (error.name === "TokenExpiredError") {
            return res.status(401).json({ success: false, error: "Your token has expired! Please log in again." });
        }

        res.status(500).json({ success: false, error: "Authentication failed." });
    }
};

// ==========================
// 🛡️ ROLE BASED ACCESS (RBAC)
// ==========================
const restrictTo = (...roles) => {
    return (req, res, next) => {
        // roles = ['admin', 'superadmin']
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: "You do not have permission to perform this action."
            });
        }
        next();
    };
};

module.exports = { authenticate, restrictTo };