// Message retention. Run on a schedule (e.g. Vercel Cron or any cron host).  Usage: node scripts/purge-old-messages.js
// Deletes chat messages older than MESSAGE_RETENTION_DAYS (default 730). Conversations with no messages are removed.
require('dotenv').config();
const mongoose = require('mongoose');
const ChatMessage = require('../src/models/ChatMessage');
const Conversation = require('../src/models/Conversation');
(async () => {
  const days = Number(process.env.MESSAGE_RETENTION_DAYS || 730);
  await mongoose.connect(process.env.MONGODB_URI);
  const r = await ChatMessage.deleteMany({ createdAt: { $lt: new Date(Date.now() - days * 86400000) } });
  const convs = await Conversation.find({ lastMessageAt: { $lt: new Date(Date.now() - days * 86400000) } }).select('_id');
  let removed = 0;
  for (const c of convs) if (!(await ChatMessage.exists({ conversation: c._id }))) { await Conversation.deleteOne({ _id: c._id }); removed++; }
  console.log(`Deleted ${r.deletedCount} messages and ${removed} empty conversations.`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
