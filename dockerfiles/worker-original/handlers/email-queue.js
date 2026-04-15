const {logger} = require('./../plugins/logger');
const {sendEmail} = require('./../functions/emails/email')


const handler = async (job) => {
    try {
      const { email, subject, body, attachment } = job.data;

      if (attachment) {
        await sendEmail(email, subject, body, attachment); // Pass attachment if it exists
      } else {
        await sendEmail(email, subject, body); // No attachment
      }
      logger.info(`Email Sent to: ${email}`);

    } catch (error) {
      logger.error('Error in sending email:', error);
      throw new Error('Error in sending Email');
    } 

  };
  
  module.exports = handler;
  
  