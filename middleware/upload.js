const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ==========================
// 📁 FOLDER SETUP (Auto-create if not exists)
// ==========================
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ==========================
// 💾 STORAGE CONFIGURATION
// ==========================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Agar aap different folders chahiye (jaise profilepics, receipts)
        // let uploadPath = uploadDir + "/others";
        // if (file.fieldname === "profilePic") uploadPath = uploadDir + "/profiles";
        // if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath);

        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Pro Tip: File name conflict rokne ke liye unique name banao (timestamp + originalname)
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
    }
});

// ==========================
// 🛡️ FILE FILTER (Security: Sirf specific files allow karo)
// ==========================
const fileFilter = (req, file, cb) => {
    // Allowed extensions
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|xls|xlsx/;

    // Check extension
    const extName = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    // Check mimetype
    const mimeType = allowedTypes.test(file.mimetype);

    if (extName && mimeType) {
        return cb(null, true); // Accept file
    } else {
        const error = new Error("Invalid file type! Only Images, PDFs, and Docs are allowed.");
        error.status = 400;
        return cb(error, false); // Reject file
    }
};

// ==========================
// ⚡ MULTER INSTANCE
// ==========================
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB Max file size limit
    }
});

module.exports = upload;