const express = require('express');
const bodyParser = require('body-parser');
const { Queue, Worker } = require('bullmq');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { Telegraf } = require('telegraf');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// Setup rate limiter
const rateLimiter = new RateLimiterMemory({
    points: 10, // 10 requests
    duration: 1, // per second
});

// Redis connection string
const redisConnectionString = process.env.REDIS_URL || 'redis://localhost:6379';


// Bull queue setup
const alertQueue = new Queue('alert-queue', {
    connection: redisConnectionString,
});



// Telegram bot setup
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const THRESHOLD_AMOUNT = parseInt(process.env.THRESHOLD_AMOUNT);

// Webhook endpoint
app.post('/alert/webhook', async (req, res) => {
    const payload = req.body;
    //   console.log(req);

    const signature = payload[0]?.signature;

    try {
        await rateLimiter.consume(signature);

        const tokenTransfers = payload[0].tokenTransfers || [];
        for (const transfer of tokenTransfers) {
            if (transfer.tokenAmount > THRESHOLD_AMOUNT && transfer.mint === process.env.USDC_ADDRESS) {
                await alertQueue.add('sendWhaleAlert', {
                    signature,
                    amount: transfer.tokenAmount,
                    from: transfer.fromUserAccount,
                    to: transfer.toUserAccount,
                    mint: transfer.mint,
                });
            }
        }

        res.json({ message: 'Webhook received successfully' });
    } catch (rateLimiterRes) {
        res.status(429).json({ message: 'Too many requests' });
    }
});

// Bull worker setup
const worker = new Worker('alert-queue', async job => {
    const { signature, amount, from, to, mint } = job.data;
    await sendWhaleAlert(signature, amount, from, to, mint);
}, {
    connection: {
        host: 'localhost',
        port: 6379,
    },
});

// Function to send whale alert via Telegram
async function sendWhaleAlert(signature, amount, from, to, mint) {
    const message = `
🚨 *Whale Alert* 🚨

💸 *Transaction*: [🅃](https://solscan.io/tx/${signature}) \`${signature}\`

💰 *Amount*: \`${amount.toLocaleString()} USDC \`

🔄 *From*: [🅵](https://solscan.io/account/${from}) \`${from}\`

🔜 *To*: [🅸](https://solscan.io/account/${to}) \`${to}\`

💳 *Mint*: [🅼](https://solscan.io/token/${mint}) \`${mint}\`

👥 *Join our Telegram group*: [@whalealert](https://t.me/whalealert)
`;

    await bot.telegram.sendMessage(process.env.CHATID, message, {
        parse_mode: 'Markdown',
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
