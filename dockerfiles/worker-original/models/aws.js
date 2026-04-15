const mongoose = require('mongoose');

const awsuserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true
    },
    userId: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    duration: {
        type: Number
    },
    startDate: {
        type: Date
    },
    endDate: {
        type: Date
    }
},
    { timestamps: true })

const awsUser = mongoose.model('awsuser', awsuserSchema)

module.exports = awsUser