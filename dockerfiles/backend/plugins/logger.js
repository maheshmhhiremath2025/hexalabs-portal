const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');
const os = require('os'); // Import os module to get the hostname

const logDirectory = process.env.NODE_ENV === 'production'
  ? path.join('/usr/src/app/shared_logs')
  : path.join(__dirname, '..', 'logs');

// Ensure log directory exists
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory);
}
const hostname = os.hostname();
// Common format for all loggers
const commonFormat = format.combine(
  format.timestamp(),
  format.printf(({ timestamp, level, message }) => {
    return `${timestamp} [${hostname}] [${level}]: ${message}`;  })
);

// Logger for API requests
const apiLogger = createLogger({
  level: 'info',
  format: commonFormat,
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    }),
    new transports.File({ filename: path.join(logDirectory, 'api.log') })
  ],
});

// Logger for general info and errors
const logger = createLogger({
  level: 'info',
  format: commonFormat,
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    }),
    new transports.File({ filename: path.join(logDirectory, 'app.log') })
  ],
});

module.exports = {
  apiLogger,
  logger
};
