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
  // Days-of-week the user is allowed to log in on. Uses JS Date.getDay():
  // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat.
  // Empty/missing = unrestricted (back-compat). For overnight sessions
  // (loginStart > loginStop, e.g. 18:45 → 01:15), the "day" is the day
  // the session STARTED on, so a Friday-evening lab can legitimately
  // continue until Saturday 01:15.
  allowedWeekdays: {
    type: [Number],
    default: undefined,
  },
  // Optional hard expiry — the login handler rejects after this date
  // regardless of loginStart/loginStop. Used for time-bounded training
  // batches so access naturally lapses without manual cleanup.
  accessExpiresAt: {
    type: Date,
    default: undefined,
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