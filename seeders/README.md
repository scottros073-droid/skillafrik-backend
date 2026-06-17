# Database Seeders Guide

This directory contains database seeding scripts to initialize SkillAfrik with essential data.

## 📋 Available Seeders

### 1. **seed-admin.js** - Create Initial Admin User
**Purpose:** Creates the first admin user for platform management

**What it does:**
- Creates admin user with email/password from .env
- Initializes admin wallet
- Creates gamification profile
- Sets admin account as active

**Usage:**
```bash
node seeders/seed-admin.js
```

**Environment Variables Required:**
```
MONGO_URI=<SET_IN_SECRET_MANAGER>
ADMIN_EMAIL=admin@skillafrik.com
ADMIN_PASSWORD=<SET_IN_SECRET_MANAGER>
```

**Output Example:**
```
🔗 Connecting to MongoDB...
✅ MongoDB connected
👤 Creating admin user...
✅ Admin user created successfully!
📋 Admin Details:
   ID: 507f1f77bcf86cd799439011
   Email: admin@skillafrik.com
   Password: SecurePassword123!
   Role: admin
   Status: active

💰 Admin wallet created
🎮 Gamification profile created

🎉 Admin seeding completed successfully!
```

**Important Notes:**
- ⚠️ Change admin password after first login
- Only creates admin if one doesn't exist
- Idempotent (safe to run multiple times)

---

### 2. **seed-settings.js** - Initialize Platform Configuration
**Purpose:** Sets up platform-wide settings and configurations

**What it does:**
- Creates commission rate settings (10% platform, 5% referral)
- Sets minimum withdrawal amount (₦5000)
- Configures premium membership tiers and pricing
- Sets up AI credit pricing
- Enables/disables platform features
- Configures payment provider settings

**Usage:**
```bash
node seeders/seed-settings.js
```

**Environment Variables Required:**
```
MONGO_URI=<SET_IN_SECRET_MANAGER>
```

**Output Example:**
```
⚙️  Creating platform settings...
✅ Platform settings created successfully!

📋 Default Configuration:
   Platform Commission Rate: 10%
   Referral Commission Rate: 5%
   Minimum Withdrawal: ₦5000
   Escrow Auto-Release: 7 days

💳 Premium Membership Pricing:
   Basic: ₦2,999/month
   Professional: ₦9,999/month
   Expert: ₦29,999/month

🤖 AI Features Enabled
   Proposal Generation: ₦100/credit
   Design Generation: ₦200/credit
   CV Generation: ₦150/credit
```

**Configuration Details:**

**Commission Rates:**
- Platform Commission: 10% (taken from each job)
- Referral Commission: 5% (bonus for referrer)

**Minimum Withdrawal:**
- ₦5,000 minimum per withdrawal request
- Prevents micro-transactions and reduces fees

**Premium Tiers:**
| Tier | Monthly Fee | Features |
|------|-------------|----------|
| Basic | Free | Limited AI credits |
| Professional | ₦9,999 | 50 proposals/month + support |
| Expert | ₦29,999 | Unlimited + dedicated support |

**AI Credits:**
- Proposal Generation: ₦100/credit
- Design Generation: ₦200/credit
- CV Generation: ₦150/credit

**Important Notes:**
- ⚠️ Modify commission rates only through admin dashboard in production
- Settings are customizable per market/region
- Feature flags allow gradual rollout of new features

---

### 3. **seed-ai-credits.js** - Initialize AI Credits for Users
**Purpose:** Sets up initial AI credits for all existing users

**What it does:**
- Scans all users in the system
- Creates AI credit records for users without credits
- Assigns credits based on user type and premium status:
  - **Admin:** Unlimited credits
  - **Expert Premium:** Unlimited credits
  - **Professional Premium:** 50 proposal + 10 design + 20 CV
  - **Free Users:** 5 proposal + 2 design + 3 CV

**Usage:**
```bash
node seeders/seed-ai-credits.js
```

**Environment Variables Required:**
```
MONGO_URI=<SET_IN_SECRET_MANAGER>
```

**Output Example:**
```
👥 Fetching all users...
Found 15 users
✅ AI Credits initialized for: John Doe (507f1f77bcf86cd799439011)
   Proposal: 50 | Design: 10 | CV: 20
✅ AI Credits initialized for: Jane Smith (507f1f77bcf86cd799439012)
   Proposal: 5 | Design: 2 | CV: 3

📊 AI Credit Initialization Summary:
   Created: 14
   Skipped (already exist): 1
   Total: 15
```

**Credit Allocation Strategy:**
- **Admin Users:** Unlimited (999,999 each) - for testing
- **Expert Premium:** Unlimited - for professional users
- **Professional Premium:** 50 proposals, 10 designs, 20 CVs
- **Basic/Free:** 5 proposals, 2 designs, 3 CVs

**Important Notes:**
- Non-destructive (skips users with existing credits)
- Safe to run after adding new features or users
- To reset a user's credits, delete their AICredit record then run seeder

---

## 🚀 Quick Start Sequence

### First-Time Setup
```bash
# 1. Setup database connection
cp .env.example .env
# Edit .env with your MongoDB URI

# 2. Create admin user
node seeders/seed-admin.js

# 3. Create platform settings
node seeders/seed-settings.js

# 4. Initialize AI credits (after creating users)
node seeders/seed-ai-credits.js

# 5. Start application
npm run dev
```

### After Adding New Users
```bash
# Assign AI credits to newly created users
node seeders/seed-ai-credits.js
```

### Reset Platform (Development Only)
```bash
# 1. Delete all collections in MongoDB
db.dropDatabase()

# 2. Run seeders in order
node seeders/seed-admin.js
node seeders/seed-settings.js
```

---

## ⚙️ Configuration Options

### Modifying Default Values

Edit seeder files to change defaults:

**In seed-settings.js:**
```javascript
// Change commission rates
platformCommissionRate: 15, // 15% instead of 10%
referralCommissionRate: 7,  // 7% instead of 5%

// Change minimum withdrawal
minWithdrawalAmount: 10000, // ₦10,000 instead of 5,000

// Change escrow release period
escrowReleaseDays: 14, // 14 days instead of 7
```

**In seed-ai-credits.js:**
```javascript
// Adjust initial credit amounts for free users
if (user.userType !== 'admin') {
  proposalCredits = 10;  // More proposals
  designCredits = 5;     // More designs
  cvCredits = 5;         // More CVs
}
```

---

## 🔍 Troubleshooting

### Connection Failed
```
Error: connect ECONNREFUSED loopback-ip:27017
```
**Solution:** Ensure MongoDB is running and MONGO_URI is correct in .env

### Duplicate Key Error
```
E11000 duplicate key error collection: skillafrik.users index: email_1
```
**Solution:** Admin user already exists, or use different email

### Model Not Found
```
Error: Cannot find module '../models/User'
```
**Solution:** Ensure you're running from backend directory: `cd backend`

### Permission Denied
```
Error: EACCES: permission denied
```
**Solution:** Check file permissions or run with appropriate user privileges

---

## 📊 Verification

After running seeders, verify in MongoDB:

```javascript
// Check admin user
db.users.findOne({ email: 'admin@skillafrik.com' })

// Check settings
db.settings.findOne({})

// Check AI credits
db.aicredits.find({}).pretty()

// Count initialized credits
db.aicredits.countDocuments({})
```

---

## 🛡️ Production Considerations

**Before deploying to production:**

1. ✅ Change ADMIN_PASSWORD to something secure
   ```
   ADMIN_PASSWORD=GenerateRandomPassword123!
   ```

2. ✅ Verify commission rates match business model
   - Review platformCommissionRate
   - Review referralCommissionRate
   - Confirm minWithdrawalAmount

3. ✅ Test payment provider settings
   - Verify Paystack credentials
   - Test in sandbox mode first

4. ✅ Audit feature flags
   - Ensure only required features are enabled
   - Test new features in staging first

5. ✅ Backup database before major changes
   ```bash
   mongodump --uri "mongodb://..." --out ./backup
   ```

6. ✅ Run seeders in staging environment first
   - Test all seeders
   - Verify data integrity
   - Check for unexpected side effects

7. ✅ Document any customizations
   - List modified default values
   - Record why changes were made
   - Keep version history

---

## 🔄 Maintenance

### Monthly Tasks
- [ ] Review admin account security
- [ ] Check if settings need updates
- [ ] Verify AI credit allocations match usage patterns

### Quarterly Tasks
- [ ] Audit commission rates (compare with competitors)
- [ ] Review minimum withdrawal amounts
- [ ] Update premium tier pricing if needed

### Annual Tasks
- [ ] Security audit of seeder scripts
- [ ] Review and update default values
- [ ] Optimize database indexes if needed

---

## 📝 Creating Custom Seeders

Template for custom seeders:

```javascript
require('dotenv').config();
const mongoose = require('mongoose');

async function seedCustomData() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected');

    // Your seeding logic here

    console.log('🎉 Seeding completed!');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

seedCustomData();
```

---

## 📞 Support

For issues:
1. Check MongoDB connection
2. Verify .env file is correctly configured
3. Review error messages carefully
4. Check Models exist in `/backend/models/`
5. Ensure all dependencies are installed

---

**Last Updated:** April 2026
**Version:** 1.0.0
