const mongoose = require('mongoose');

const emailSchema = new mongoose.Schema({  
  name:{
    type: String,
    required: true,
  },
  subject: {
    type: String,
    required: true
  },
  body: {
    type: String,
    required: true
  } 
  },
{timestamps: true})

const Email = mongoose.model('email', emailSchema)

module.exports = Email