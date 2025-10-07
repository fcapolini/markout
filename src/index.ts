import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

const app = express();
const port = process.env.PORT || 3000;

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Stricter rate limiting for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many requests to this endpoint, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all requests
app.use(limiter);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Hello World from TypeScript Express!' });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Example of a route with stricter rate limiting
app.post('/api/sensitive', strictLimiter, (req: Request, res: Response) => {
  res.json({
    message: 'This is a sensitive endpoint with stricter rate limiting',
    data: 'Some sensitive operation completed',
  });
});

// Route to check rate limit status
app.get('/api/rate-limit-status', (req: Request, res: Response) => {
  res.json({
    message: 'Rate limit status',
    headers: {
      'rateLimit-limit': res.get('RateLimit-Limit'),
      'rateLimit-remaining': res.get('RateLimit-Remaining'),
      'rateLimit-reset': res.get('RateLimit-Reset'),
    },
  });
});

// Start server only if not in test environment
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

export default app;
