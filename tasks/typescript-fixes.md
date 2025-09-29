# TypeScript Compilation Errors - Fix Plan

## Errors Found

### 1. Missing `require` definition (CommonJS)
- `src/connectors/cpscConnector.ts(33,11)`: Cannot find name 'require'
- `src/connectors/nhtsaConnector.ts(232,7)`: Cannot find name 'require'

### 2. Missing return statements
- `src/controllers/recommendationController.ts(55,9)`: Not all code paths return a value
- `src/controllers/trustController.ts(101,9)`: Not all code paths return a value
- `src/middleware/auth.ts(3,17)`: Not all code paths return a value

### 3. Null type issues
- `src/controllers/trustController.ts(36,9)`: Type 'null' not assignable
- `src/controllers/trustController.ts(140,9)`: Type 'null' not assignable

### 4. Unused variables/parameters
- `src/jobs/scoreRecompute.ts(7,11)`: 'RecomputeOptions' declared but never used
- `src/middleware/errorHandler.ts(5,3)`: 'req' declared but never read
- `src/middleware/errorHandler.ts(7,3)`: 'next' declared but never read
- `src/parsers/policyParser.ts(83,11)`: 'currentUserAgent' declared but never used
- `src/parsers/policyParser.ts(450,50)`: 'url' declared but never used
- `src/parsers/policyParser.ts(468,5)`: 'localeHint' declared but never used
- `src/services/trustScore.test.ts(168,15)`: 'mockEvents' declared but never read
- `src/services/trustScore.test.ts(171,15)`: 'mockConfig' declared but never read
- `src/services/trustScore.ts(300,5)`: 'serviceId' declared but never used

### 5. Possibly undefined
- `src/parsers/policyParser.ts(503-506)`: 'regexFields.coverage' is possibly 'undefined'

### 6. Type incompatibility
- `src/parsers/policyParser.ts(587,9)`: ParsedPolicy not assignable to InputJsonValue

### 7. Uninitialized property
- `src/services/trustScore.ts(63,11)`: Property 'config' has no initializer

## Fix Strategy

Simple fixes by category:
1. Add `_` prefix to unused parameters (Express convention)
2. Add explicit return statements where missing
3. Fix null checks with proper type guards
4. Initialize class properties properly
5. Cast types appropriately for Prisma JSON fields
6. Add optional chaining for possibly undefined values

## Fixes

- [x] Fix connector require statements (added NodeRequire/NodeModule declarations)
- [x] Fix missing return statements (3 locations in controllers)
- [x] Fix unused variables (added _ prefix to 11 variables)
- [x] Fix possibly undefined coverage field (added optional chaining)
- [x] Fix config initialization in trustScore (added definite assignment assertion)
- [x] Fix JSON type compatibility (added type cast)
- [x] Fix null type issues (2 locations in trustController)
- [ ] Verify build passes