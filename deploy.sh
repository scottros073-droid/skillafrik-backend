#!/bin/bash

# SkillAfrik Production Deployment Script
# Run this script on your production server

set -e  # Exit on any error

echo "🚀 Starting SkillAfrik Production Deployment"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'.' -f1 | cut -d'v' -f2)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm ci --only=production

# Create logs directory
echo "📁 Creating logs directory..."
mkdir -p logs

# Check if .env.production exists
if [ ! -f ".env.production" ]; then
    echo "⚠️  .env.production not found. Copying from example..."
    cp .env.production.example .env.production
    echo "✏️  Please edit .env.production with your production values"
    echo "   Then run: npm run deploy"
    exit 1
fi

# Validate environment variables
echo "🔍 Validating environment variables..."
REQUIRED_VARS=("NODE_ENV" "FRONTEND_URL" "MONGO_URI" "JWT_SECRET" "JWT_REFRESH_SECRET")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo "❌ Missing required environment variables:"
    printf '   - %s\n' "${MISSING_VARS[@]}"
    echo "   Please set them in .env.production"
    exit 1
fi

# Run tests
echo "🧪 Running tests..."
npm test

# Build check (if you have build steps)
# echo "🔨 Building application..."
# npm run build

# Install PM2 if not installed
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
fi

# Stop existing application
echo "🛑 Stopping existing application..."
pm2 stop skillafrik-api || true
pm2 delete skillafrik-api || true

# Start application with PM2
echo "▶️  Starting application..."
pm2 start server.js --name "skillafrik-api" --env production

# Save PM2 configuration
pm2 save

# Health check
echo "🏥 Running health check..."
sleep 5

HEALTH_ENDPOINT=${HEALTH_ENDPOINT:-https://afrikskill-hash.onrender.com/api/health}
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_ENDPOINT" || echo "000")
if [ "$HEALTH_RESPONSE" -eq 200 ]; then
    echo "✅ Health check passed!"
    echo "🌐 Application is running at $HEALTH_ENDPOINT"
    echo "📊 Health endpoint: $HEALTH_ENDPOINT"
else
    echo "❌ Health check failed! HTTP Status: $HEALTH_RESPONSE"
    echo "📋 Check logs with: pm2 logs skillafrik-api"
    exit 1
fi

# Setup PM2 startup (optional)
read -p "🔄 Setup PM2 auto-startup on server boot? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    pm2 startup
    pm2 save
    echo "✅ PM2 auto-startup configured"
fi

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Useful commands:"
echo "   pm2 status                 # Check application status"
echo "   pm2 logs skillafrik-api    # View application logs"
echo "   pm2 restart skillafrik-api # Restart application"
echo "   pm2 monit                  # Monitor application"
echo ""
echo "🔒 Don't forget to:"
echo "   - Configure nginx reverse proxy"
echo "   - Setup SSL certificate"
echo "   - Configure firewall"
echo "   - Setup monitoring"
echo ""
echo "📖 See PRODUCTION_DEPLOYMENT.md for detailed instructions"