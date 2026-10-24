const mongoose = require('mongoose');

// Cache the connection across serverless invocations.
const cached = global._msukashaMongo || (global._msukashaMongo = { conn: null, promise: null });

module.exports = async function connectDB() {
  if (cached.conn && mongoose.connection.readyState === 1) return cached.conn;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');

  if (!cached.promise) {
    mongoose.set('strictQuery', true);
    cached.promise = mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 5
    });
  }
  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }
  return cached.conn;
};
