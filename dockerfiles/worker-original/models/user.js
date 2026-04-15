const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  organization: {
    type: String,
    required: true,
  },
  name: {
    type: String,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  trainingName: {
    type: String,
  },
  password: {
    type: String,
    required: true,
  },
  userType: {
    type: String,
    required: true
  },
  loginStart: {
    type: String
  },
  loginStop: {
    type: String
  },
  permissions: {
    type: [],
  }

},
  { timestamps: true })

const User = mongoose.model('users', userSchema)

module.exports = User