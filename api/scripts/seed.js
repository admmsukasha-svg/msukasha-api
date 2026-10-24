// Usage: node scripts/seed.js      (idempotent: only inserts what is missing)
// Seeds the initial category tree and DRAFT policy pages. Policy text is a starting point and MUST be
// reviewed by qualified legal counsel before launch. No users, suppliers, products or statistics are created.
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../src/models/Category');
const PageContent = require('../src/models/PageContent');
const { slugify } = require('../src/utils/helpers');

const TREE = {
  'Electronics': ['Consumer Electronics', 'Computer Hardware', 'Lighting', 'Electrical Components'],
  'Mobile Phones and Accessories': ['Smartphones', 'Cases and Covers', 'Chargers and Cables', 'Audio Accessories'],
  'Machinery and Industrial Equipment': ['Manufacturing Machinery', 'Packaging Machinery', 'Pumps and Valves', 'Tools and Hardware'],
  'Fashion and Apparel': ['Men', 'Women', 'Children', 'Footwear', 'Uniforms and Workwear'],
  'Textiles': ['Fabrics', 'Yarn and Thread', 'Home Textiles', 'Knitwear'],
  'Agriculture and Food Products': ['Rice and Grains', 'Fruits and Vegetables', 'Spices', 'Fertilizers and Seeds'],
  'Sports Goods': ['Football and Team Sports', 'Fitness Equipment', 'Cricket', 'Sportswear'],
  'Surgical and Medical Supplies': ['Surgical Instruments', 'Disposables', 'Hospital Furniture'],
  'Home and Garden': ['Furniture', 'Kitchenware', 'Garden Supplies', 'Decor'],
  'Beauty and Personal Care': ['Skin Care', 'Hair Care', 'Fragrance', 'Personal Hygiene'],
  'Vehicles and Automotive': ['Auto Parts', 'Motorcycles and Parts', 'Tyres', 'Accessories'],
  'Construction Materials': ['Tiles and Flooring', 'Steel and Metals', 'Paints and Coatings', 'Sanitary Ware'],
  'Other Permitted Categories': []
};
const RESTRICTED = new Set(['Surgical and Medical Supplies']);

const DRAFT = 'DRAFT — this page must be reviewed by qualified legal counsel before launch.\n\n';
const PAGES = {
  'terms-of-service': ['Terms of Service', DRAFT + 'MSUKASHA is an online marketplace that connects buyers and sellers. MSUKASHA is not a party to contracts between users and does not guarantee any transaction, quality, delivery or payment unless a specific service says so in writing. Basic accounts and basic stores are free. Paid services are shown only when they are available and configured. Users must provide accurate information and must not list prohibited items.'],
  'privacy-policy': ['Privacy Policy', DRAFT + 'We collect the information you give us (account, business profile, listings, messages) and technical data needed to run and secure the service. Tax IDs, identity documents and private addresses are never shown publicly. Verification documents are accessible only to authorised reviewers and every access is logged. You can export your data and delete your account from your dashboard settings.'],
  'seller-guidelines': ['Seller Guidelines', DRAFT + 'Describe products accurately, use your own photos, state real prices and minimum order quantities, answer buyers honestly, and do not claim certifications or inspections you do not hold. Misleading listings may be removed and accounts suspended.'],
  'prohibited-items': ['Prohibited Items Policy', DRAFT + 'Not allowed: weapons and ammunition, narcotics, counterfeit goods, stolen goods, forged documents, and anything illegal in the seller\'s or buyer\'s jurisdiction. Restricted categories (for example medical supplies) require additional review.'],
  'verification-policy': ['Verification Policy', DRAFT + 'Email Verified: the account holder confirmed control of the email address. Phone Verified: control of the phone number was confirmed. Business Documents Reviewed: a reviewer examined documents submitted by the supplier and found them consistent with the business profile. Additional Verification: shown only after a defined extra review has actually taken place. A badge is not a guarantee of any transaction.'],
  'dispute-policy': ['Reporting and Disputes', DRAFT + 'Use the Report button on any listing, supplier or conversation. Reports are reviewed by our moderation team; actions taken are recorded. MSUKASHA does not currently provide escrow, payment protection or guaranteed refunds.'],
  'about': ['About MSUKASHA', 'MSUKASHA is a Pakistan-based B2B marketplace and C2C classifieds platform at an early launch stage. We help manufacturers, wholesalers, distributors, exporters and retailers publish a business profile, list products and receive buyer inquiries and requests for quotation.']
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  let order = 0, created = 0;
  for (const [name, kids] of Object.entries(TREE)) {
    let parent = await Category.findOne({ slug: slugify(name) });
    if (!parent) { parent = await Category.create({ name, slug: slugify(name), order: order * 10, restricted: RESTRICTED.has(name) }); created++; }
    order++;
    let k = 0;
    for (const kid of kids) {
      const slug = slugify(`${name}-${kid}`);
      if (!(await Category.exists({ slug }))) { await Category.create({ name: kid, slug, parent: parent._id, order: k * 10 }); created++; }
      k++;
    }
  }
  let pages = 0;
  for (const [slug, [title, body]] of Object.entries(PAGES)) {
    if (!(await PageContent.exists({ slug }))) { await PageContent.create({ slug, title, body }); pages++; }
  }
  console.log(`Seed complete: ${created} categories and ${pages} draft pages added.`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
