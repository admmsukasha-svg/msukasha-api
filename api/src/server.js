// Local development server:  npm run dev
require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 5000;
connectDB()
  .then(() => app.listen(PORT, () => console.log(`MSUKASHA API running on http://localhost:${PORT}`)))
  .catch((err) => { console.error('Failed to start:', err.message); process.exit(1); });
