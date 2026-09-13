const amqp = require('amqplib');

let channel = null;

async function connectRabbitMQ() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
  channel = await connection.createChannel();
  console.log('RabbitMQ connected');
  return channel;
}

function getChannel() {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized — call connectRabbitMQ() first');
  }
  return channel;
}

async function publishToQueue(queue, message) {
  const ch = getChannel();
  await ch.assertQueue(queue, { durable: true });
  ch.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true });
}

module.exports = { connectRabbitMQ, getChannel, publishToQueue };