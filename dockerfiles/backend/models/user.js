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

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('users', userSchema)

module.exports = User