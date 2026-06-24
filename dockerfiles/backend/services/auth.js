const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET;
if (!secret) {
    throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start without it.');
}

function setUser(user, tenantHost){
    return jwt.sign({
        _id: user._id,
        email: user.email,
        organization: user.organization,
        userType: user.userType,
        tenantHost: tenantHost || null
    }, secret, { expiresIn: '24h' })
}
function getUser(token){
    if(!token) return null
    try {
        return jwt.verify(token, secret);
    } catch (error) {
        return null
    }

}

module.exports = {setUser, getUser}