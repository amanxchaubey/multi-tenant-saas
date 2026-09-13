require('dotenv').config();
const app = require('./app');
const { connectRabbitMQ } = require('./config/rabbitmq');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await connectRabbitMQ();
  } catch (err) {
    console.warn('RabbitMQ not available, continuing without it:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`multi-tenant-saas listening on port ${PORT}`);
  });
}

start();