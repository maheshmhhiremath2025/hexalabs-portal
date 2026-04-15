const mongoose = require('mongoose');

const sandboxuserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
    },
    userId: {
        type: String,
        required: true
    },
    duration: {
        type: Number
    },
    credits: {
        total: {
            type: Number,
        },
        consumed: {
            type: Number,
        }
    },
    sandbox: [
        {
            resourceGroupName: {
                type: String
            },
            createdTime: {
                type: Date
            },
            deleteTime: {
                type: Date
            }
        }
    ],
    startDate: {
        type: Date
    },
    endDate: {
        type: Date
    }
},
    { timestamps: true })

const SandboxUser = mongoose.model('sandboxuser', sandboxuserSchema)

module.exports = SandboxUser