require('dotenv').config();
const nodemailer = require("nodemailer");

// Create a transporter outside the function
const transporter = nodemailer.createTransport({
  service: "Gmail",
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER, // stored in .env file
    pass: process.env.GMAIL_PASS, // use App Password if 2FA enabled
  },
});

// Define the function that sends the email
const sendEmail = (to, subject, html, attachment) => {
  // Create mail options
  const mailOptions = {
    from: process.env.GMAIL_USER, // use authenticated email
    to,
    cc: "itops@synergificsoftware.com",
    subject,
    html,
    // Conditionally include attachments if provided
    ...(attachment && { attachments: [attachment] })
  };

  // Return a promise to handle the sending process
  return new Promise((resolve, reject) => {
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        reject(error);
      } else {
        resolve(info);
      }
    });
  });
};

// Export the sendEmail function
module.exports = { sendEmail };
