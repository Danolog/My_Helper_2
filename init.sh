#!/bin/bash

# MyHelper - Development Environment Setup Script
# This script sets up and runs the development environment for the MyHelper application
# Stack: Next.js 16 + React 19 + PostgreSQL 18 + Drizzle ORM + Better Auth

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=======================================${NC}"
echo -e "${BLUE}  MyHelper Development Environment    ${NC}"
echo -e "${BLUE}=======================================${NC}"
echo ""

# Check Node.js version
echo -e "${YELLOW}Checking Node.js version...${NC}"
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 22 ]; then
        echo -e "${GREEN}✓ Node.js $(node -v) found${NC}"
    else
        echo -e "${RED}✗ Node.js 22+ required, found $(node -v)${NC}"
        echo -e "${YELLOW}  Please install Node.js 22+ or use nvm:${NC}"
        echo -e "${YELLOW}  nvm install 22 && nvm use 22${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ Node.js not found. Please install Node.js 22+${NC}"
    exit 1
fi

# Check pnpm
echo -e "${YELLOW}Checking pnpm...${NC}"
if command -v pnpm &> /dev/null; then
    echo -e "${GREEN}✓ pnpm $(pnpm -v) found${NC}"
else
    echo -e "${YELLOW}Installing pnpm...${NC}"
    npm install -g pnpm
    echo -e "${GREEN}✓ pnpm installed${NC}"
fi

# Check Docker
echo -e "${YELLOW}Checking Docker...${NC}"
if command -v docker &> /dev/null; then
    if docker info &> /dev/null; then
        echo -e "${GREEN}✓ Docker is running${NC}"
    else
        echo -e "${RED}✗ Docker is not running. Please start Docker Desktop.${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ Docker not found. Please install Docker Desktop.${NC}"
    exit 1
fi

# Start PostgreSQL via Docker Compose
echo ""
echo -e "${YELLOW}Starting PostgreSQL database...${NC}"
if [ -f "docker-compose.yml" ]; then
    docker compose up -d postgres
    echo -e "${GREEN}✓ PostgreSQL container started${NC}"

    # Wait for PostgreSQL to be ready
    echo -e "${YELLOW}Waiting for PostgreSQL to be ready...${NC}"
    sleep 5

    # Check if PostgreSQL is accepting connections
    for i in {1..30}; do
        if docker compose exec -T postgres pg_isready -U myhelper &> /dev/null; then
            echo -e "${GREEN}✓ PostgreSQL is ready${NC}"
            break
        fi
        if [ $i -eq 30 ]; then
            echo -e "${RED}✗ PostgreSQL failed to start within 30 seconds${NC}"
            exit 1
        fi
        sleep 1
    done
else
    echo -e "${YELLOW}docker-compose.yml not found, creating...${NC}"
    cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: myhelper-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: myhelper
      POSTGRES_PASSWORD: myhelper_dev_password
      POSTGRES_DB: myhelper
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myhelper"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
EOF
    docker compose up -d postgres
    echo -e "${GREEN}✓ PostgreSQL container created and started${NC}"
    sleep 5
fi

# Create .env file if not exists
echo ""
echo -e "${YELLOW}Checking environment configuration...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}Creating .env file...${NC}"
    cat > .env << 'EOF'
# Database
DATABASE_URL="postgresql://myhelper:myhelper_dev_password@localhost:5432/myhelper"

# Better Auth
BETTER_AUTH_SECRET="development-secret-key-change-in-production-min-32-chars"
BETTER_AUTH_URL="http://localhost:3000"

# Next.js
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Stripe (add your keys for payment features)
# STRIPE_SECRET_KEY=""
# STRIPE_PUBLISHABLE_KEY=""
# STRIPE_WEBHOOK_SECRET=""

# OpenRouter AI (add for Pro features)
# OPENROUTER_API_KEY=""

# SMS Provider (add for notification features)
# SMS_API_KEY=""

# Vercel Blob Storage (optional, uses local storage as fallback)
# BLOB_READ_WRITE_TOKEN=""
EOF
    echo -e "${GREEN}✓ .env file created${NC}"
    echo -e "${YELLOW}  Note: Update .env with your API keys for full functionality${NC}"
else
    echo -e "${GREEN}✓ .env file exists${NC}"
fi

# Install dependencies
echo ""
echo -e "${YELLOW}Installing dependencies...${NC}"
pnpm install
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Run database migrations if drizzle is configured
echo ""
echo -e "${YELLOW}Checking database schema...${NC}"
if [ -f "drizzle.config.ts" ] || [ -f "drizzle.config.js" ]; then
    echo -e "${YELLOW}Running database migrations...${NC}"
    pnpm drizzle-kit push 2>/dev/null || pnpm db:push 2>/dev/null || echo -e "${YELLOW}  Note: Run migrations manually if needed${NC}"
else
    echo -e "${YELLOW}  Drizzle config not found - migrations will be set up during development${NC}"
fi

# Start the development server
echo ""
echo -e "${GREEN}=======================================${NC}"
echo -e "${GREEN}  Starting Development Server         ${NC}"
echo -e "${GREEN}=======================================${NC}"
echo ""
echo -e "${BLUE}Application URLs:${NC}"
echo -e "  ${GREEN}→${NC} Local:         http://localhost:3000"
echo -e "  ${GREEN}→${NC} Salon Panel:   http://localhost:3000/dashboard"
echo -e "  ${GREEN}→${NC} Client Portal: http://localhost:3000/client"
echo -e "  ${GREEN}→${NC} API:           http://localhost:3000/api"
echo ""
echo -e "${BLUE}Database:${NC}"
echo -e "  ${GREEN}→${NC} PostgreSQL:    localhost:5432"
echo -e "  ${GREEN}→${NC} Database:      myhelper"
echo -e "  ${GREEN}→${NC} User:          myhelper"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop the server${NC}"
echo ""

# Start Next.js development server
pnpm dev
