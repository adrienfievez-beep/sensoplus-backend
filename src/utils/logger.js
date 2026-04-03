const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';
const LOG_DIR = path.join(process.cwd(), 'logs');

// ── Formats ───────────────────────────────────────────────────

const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ timestamp, level, message, stack }) =>
    stack
      ? `[${timestamp}] ${level}: ${message}\n${stack}`
      : `[${timestamp}] ${level}: ${message}`
  )
);

const fileFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json()   // JSON structuré — exploitable par Loki, Datadog, etc.
);

// ── Transports ────────────────────────────────────────────────

const loggerTransports = [
  // Console toujours active
  new transports.Console({
    format: consoleFormat,
    silent: process.env.NODE_ENV === 'test',
  }),
];

if (isProd) {
  // Fichier combiné (info+) avec rotation quotidienne
  loggerTransports.push(
    new transports.DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'sensoplus-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',       // rotation si > 20 Mo
      maxFiles: '14d',      // conserver 14 jours
      zippedArchive: true,
      format: fileFormat,
      level: 'info',
    })
  );

  // Fichier erreurs uniquement
  loggerTransports.push(
    new transports.DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'sensoplus-error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '30d',
      zippedArchive: true,
      format: fileFormat,
      level: 'error',
    })
  );
}

// ── Logger ────────────────────────────────────────────────────

const logger = createLogger({
  level: isProd ? 'info' : 'debug',
  transports: loggerTransports,
  // Ne pas crasher sur les erreurs de transport
  exitOnError: false,
});

module.exports = logger;
