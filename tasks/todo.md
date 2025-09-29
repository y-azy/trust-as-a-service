# Fix Docker Build - Missing package-lock.json

## Problem
Docker build fails because `npm ci` requires `package-lock.json` files, but they don't exist in backend/ and frontend/ directories.

## Root Cause
When the project was scaffolded, only `package.json` files were created without running `npm install` to generate the lock files.

## Solution Plan

- [x] Generate package-lock.json for backend by running `npm install`
- [x] Generate package-lock.json for frontend by running `npm install`
- [x] Fixed package.json dependency: replaced `robotstxt-parser` with `robots-parser@^3.0.1`
- [ ] Fix TypeScript compilation errors (discovered during Docker build)
- [ ] Verify Docker build completes successfully

## Implementation Steps

### 1. Generate backend lock file
```bash
cd backend && npm install
```

### 2. Generate frontend lock file
```bash
cd frontend && npm install
```

### 3. Test Docker build
```bash
docker-compose up --build
```

## Expected Outcome
- Both directories will have `package-lock.json` files
- Docker build will succeed
- All services (postgres, redis, backend, frontend) will start successfully

## Review
_To be filled after completion_