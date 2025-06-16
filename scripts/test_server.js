const express = require('express');
const app = express();
const port = 3000;

console.log('Creating Express app...');

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Test server running' });
});

app.get('/', (req, res) => {
  res.json({ message: 'Hello from test server!' });
});

console.log('Starting server on port', port);

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Test server running on port ${port}`);
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
});

console.log('Server setup complete'); 