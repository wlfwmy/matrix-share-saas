module.exports = {
  apps: [
    {
      name: 'matrix-api',
      script: './dist/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production' },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
    },
    {
      name: 'matrix-worker',
      script: './dist/queues/publish.worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
    }
  ]
};
