const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || "Kri$han@!4!2";

function setUser(user){
    return jwt.sign({
        _id: user._id,
        email: user.email,
        organization: user.organization,
        userType: user.userType
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