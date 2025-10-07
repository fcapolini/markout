module.exports = {
  apps: [
    {
      name: 'typescript-express-app',
      script: 'dist/index.js',
      instances: 'max', // Use all available CPU cores
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Logging
      log_file: 'logs/combined.log',
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Process management
      min_uptime: '10s',
      max_restarts: 10,

      // Advanced features
      node_args: '--max-old-space-size=1024',

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,

      // Health monitoring
      health_check_http_url: 'http://localhost:3000/health',
      health_check_grace_period: 10000,

      // Merge logs from all instances
      merge_logs: true,
    },
  ],
};
