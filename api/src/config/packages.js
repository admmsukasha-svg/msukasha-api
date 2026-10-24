// Advertising packages. !!! CHANGE THE PRICES (PKR) AND DURATIONS TO YOUR REAL RATES !!!
// The price is always taken from here on the server, never from the browser.
const PACKAGES = {
  starter:  { name: 'Starter',  price: 3000,  duration: 7,  priority: 1 },
  business: { name: 'Business', price: 10000, duration: 30, priority: 2 },
  premium:  { name: 'Premium',  price: 25000, duration: 30, priority: 3 }
};
module.exports = { PACKAGES };
