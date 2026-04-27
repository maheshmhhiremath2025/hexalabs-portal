const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

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

// Hash password before saving — mirrors backend/models/user.js so users
// auto-created by the worker (during VM/RDS/Container/Sandbox provisioning)
// can log into the portal with the default password right away.
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

const User = mongoose.model('users', userSchema)

module.exports = User