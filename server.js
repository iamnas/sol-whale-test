const express = require('express');
const bodyParser = require('body-parser');
const redis = require('redis');
const axios = require('axios');

// Load environment variables from .env file
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// const redisClient = redis.createClient({
//   url: process.env.REDIS_URL, // Use REDIS_URL from environment variables
//   pingInterval: 3000,
// });

// redisClient.on('error', (err) => console.log('Redis Client Error', err));

// (async () => {
//   await redisClient.connect();
//   console.log('Connected to Redis successfully!');
// })();
const redisClient = redis.createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries >= 10) {
        return new Error('Redis connection attempts exceeded');
      }
      console.log(`Reconnecting to Redis: attempt #${retries}`);
      return Math.min(retries * 100, 3000); // Exponential backoff
    },
    tls: true,
  },
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.on('reconnecting', () => console.log('Reconnecting to Redis...'));

(async () => {
  try {
    await redisClient.connect();
    console.log('Connected to Redis successfully!');
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
  }
})();

// Initialize the tokenLogs array to keep track of processed transactions
let tokenLogs = [];

app.get('/', (req, res) => {
  res.json({ message: 'Webhook received successfully' });
})


app.post('/alert/webhook', async (req, res) => {
  try {
    const payload = req.body;
    const signature = payload[0]?.signature;

    // Check if the webhook has already been processed
    if (tokenLogs.includes(signature)) {
      return res.status(200).json({ message: 'Webhook already processed' });
    }

    const tokenTransfers = payload[0].tokenTransfers || [];

    for (const transfer of tokenTransfers) {
      if (
        transfer.tokenAmount > parseInt(process.env.THRESHOLD_AMOUNT) &&
        transfer.mint === process.env.USDC_ADDRESS
      ) {
        // Send whale alert
        const message = `
🚨 *Whale Alert* 🚨

💸 *Transaction*: [🅃](https://solscan.io/tx/${signature}) \`${signature}\`

💰 *Amount*: \`${transfer.tokenAmount.toLocaleString()} USDC\`

🔄 *From*: [🅵](https://solscan.io/account/${transfer.fromUserAccount}) \`${transfer.fromUserAccount}\`

🔜 *To*: [🅸](https://solscan.io/account/${transfer.toUserAccount}) \`${transfer.toUserAccount}\`

💳 *Mint*: [🅼](https://solscan.io/token/${transfer.mint}) \`${transfer.mint}\`

`;
        // 👥 *Join our Telegram group*: [@whalealert](https://t.me/whalealert)

        await redisClient.set(signature, message);
        tokenLogs.push(signature);

        await sendTelegramAlert(message);
      }
    }

    res.status(200).json({ message: 'Webhook received successfully' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

async function sendTelegramAlert(message) {
  const telegramApiUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(telegramApiUrl, {
      chat_id: process.env.CHATID,
      text: message,
      parse_mode: 'Markdown',
    });
  } catch (error) {
    console.error('Error sending Telegram message:', error);
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
