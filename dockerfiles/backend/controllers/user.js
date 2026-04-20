const { logger } = require('./../plugins/logger');
const User = require('./../models/user');
const { setUser } = require('../services/auth');
const { recordLoginFailure, recordLoginSuccess } = require('../middlewares/loginRateLimit');

const moment = require('moment-timezone');

async function handleUserLogin(req, res) {
    // Check if the user is already logged in
    if (req.user) {
        logger.info(`${req.user.email} attempted to log in again from ${req.ip}`);
        return res.status(200).json("Already logged in");
    }

    const { email, password } = req.body;
    try {
        // Validate input
        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        const user = await User.findOne({ email });
        if (!user || !(await user.comparePassword(password))) {
            recordLoginFailure(req);
            return res.status(400).json({ message: "Invalid Credentials" });
        }

        // ─── Hard access expiry (batches with a fixed end date) ───────
        if (user.accessExpiresAt && new Date(user.accessExpiresAt) < new Date()) {
            recordLoginFailure(req);
            logger.warn(`${email} tried to log in after access expired (${user.accessExpiresAt})`);
            return res.status(403).json({ message: "Your access has expired. Contact your administrator." });
        }

        // ─── Login-time window (supports overnight windows crossing midnight) ─
        //   same-day window: start <= stop (e.g. 09:00-17:00)
        //   overnight window: start > stop  (e.g. 18:45-01:15)
        // For the weekday check we track "which day the session belongs to":
        // a login at Tue 00:30 during a Mon-started window counts as Monday.
        let effectiveDay = moment().tz("Asia/Kolkata").day();  // 0=Sun..6=Sat
        if (user.loginStart && user.loginStop) {
            const nowIst = moment().tz("Asia/Kolkata");
            const cur = nowIst.format("HH:mm");
            const start = user.loginStart;
            const stop  = user.loginStop;
            let inWindow = false;
            if (start <= stop) {
                inWindow = cur >= start && cur <= stop;
            } else {
                // Overnight: allowed if (cur >= start) OR (cur <= stop)
                if (cur >= start) { inWindow = true; }
                else if (cur <= stop) { inWindow = true; effectiveDay = nowIst.clone().subtract(1, "day").day(); }
            }
            if (!inWindow) {
                recordLoginFailure(req);
                logger.warn(`${email} attempted to log in outside allowed hours (${start}-${stop}) from ${req.ip}`);
                return res.status(403).json({ message: `Login is only allowed between ${start} and ${stop} IST.` });
            }
        }

        // ─── Weekday restriction (array of 0-6, JS Date.getDay format) ────────
        if (Array.isArray(user.allowedWeekdays) && user.allowedWeekdays.length > 0) {
            if (!user.allowedWeekdays.includes(effectiveDay)) {
                recordLoginFailure(req);
                const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
                const allowed = user.allowedWeekdays.map(d => dayNames[d]).join(", ");
                logger.warn(`${email} attempted to log in on ${dayNames[effectiveDay]} (allowed: ${allowed}) from ${req.ip}`);
                return res.status(403).json({ message: `Access is only allowed on: ${allowed}.` });
            }
        }

        // Generate token
        const token = setUser(user);

        // Determine userCode based on user type
        let userCode;
        switch (user.userType) {
            case 'admin':
                userCode = "z829Sgry6AkYJ";
                break;
            case 'superadmin':
                userCode = "hpQ3s5dK247";
                break;
            case 'sandboxuser':
                userCode = "h1Qjasd233jd";
                break;
            case 'selfservice':
                userCode = "sS3lf5v1cE2b";
                break;
            default:
                userCode = "QtoA4s58yjXk27";
                break;
        }

        // Successful login — clear rate-limit counters for this IP + email
        recordLoginSuccess(req);

        // Log login activity
        logger.info(`${email} logged in from ${req.ip}`);

        res.status(200).json({
            uid: token, // Include token in JSON response
            organization: user.organization,
            email: user.email,
            AH1apq12slurt5: userCode
        });

    } catch (error) {
        logger.error(`Error in handleUserLogin: ${error.message}`);
        res.status(500).json({ message: "Internal Server Error" });
    }
}


async function handleUserLogout(req, res) {
    try {
        res.status(200).json({ message: "Logged out" });
        logger.info(`User logged out from ${req.ip}`);
    } catch (error) {
        logger.error(`Error in handleUserLogout: ${error.message}`);
        res.status(500).json({ message: "Logout failed" });
    }
}



module.exports = { handleUserLogin, handleUserLogout }