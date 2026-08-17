const express = require('express');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'CICT-Cert backend is running'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`CICT-Cert backend running on http://localhost:${PORT}`);
});