const {getUser} = require('./../services/auth')
const {apiLogger} = require('./../plugins/logger')

async function restrictToLoggedinUserOnly(req, res, next) {
    try {
        // Extract the token from the Authorization header
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: "User not logged in" });
        }

        const token = authHeader.split(' ')[1]; // Extract the token part
        if (!token) {
            return res.status(401).json({ message: "User not logged in" });
        }

        // Validate the token (replace getUser with your token validation logic)
        const user = getUser(token); // Ensure getUser handles token validation properly

        if (!user) {
            return res.status(401).json({ message: "Invalid or expired token" });
        }

        // Attach the user to the request object for use in subsequent middleware or routes
        req.user = user;

        // Log the user activity
        apiLogger.info(`${user.email}: ${req.ip} ${req.method}: ${req.url}`);

        next(); // Proceed to the next middleware or route handler
    } catch (error) {
        console.error('Error in restrictToLoggedinUserOnly:', error.message);
        res.status(500).json({ message: "Internal Server Error" });
    }
}

async function checkAuth(req, res, next) {
    try {
        // Extract the token from the Authorization header
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            req.user = null; // No token, no user
            return next(); // Proceed without user authentication
        }

        const token = authHeader.split(' ')[1]; // Extract the token part
        if (!token) {
            req.user = null; // Malformed token, no user
            return next(); // Proceed without user authentication
        }

        // Validate the token (replace getUser with your actual token validation logic)
        const user = getUser(token); // Ensure getUser handles token validation properly

        if (!user) {
            req.user = null; // Invalid or expired token
        } else {
            req.user = user; // Attach the user to the request
        }

        next(); // Proceed to the next middleware or route handler
    } catch (error) {
        console.error('Error in checkAuth:', error.message);
        req.user = null; // Set user to null on error
        next(); // Proceed without user authentication
    }
}

module.exports = {restrictToLoggedinUserOnly, checkAuth}