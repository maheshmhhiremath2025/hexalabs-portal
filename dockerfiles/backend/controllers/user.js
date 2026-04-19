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

        // Check login time restrictions if they exist
        if (user.loginStart && user.loginStop) {
            const currentISTTime = moment().tz("Asia/Kolkata").format("HH:mm");
            if (currentISTTime < user.loginStart || currentISTTime > user.loginStop) {
                logger.warn(`${email} attempted to log in outside allowed hours from ${req.ip}`);
                return res.status(403).json({ message: "Trying to log in outside allowed time" });
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