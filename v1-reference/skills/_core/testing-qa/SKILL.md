---
name: testing-qa
description: >
  CORE TESTING LAYER - Auto-invoke when writing or modifying any code, creating
  new components, API routes, utilities, hooks, or services. Enforces test coverage
  expectations, testing patterns (unit/integration/e2e), mocking strategies, TDD
  workflow, edge case identification, and test naming conventions. Also invoke when
  reviewing PRs or refactoring existing code. ALWAYS active.
---

# 🧪 Testing & QA — Core Layer

Mandatory testing standards for every project. No code ships without appropriate tests.

## Live Scan

!`echo "=== Test framework ===" && (jq -r '.devDependencies | keys[]' package.json 2>/dev/null | grep -iE "jest|vitest|mocha|cypress|playwright|testing-library|maestro" || echo "No test framework detected")`
!`echo "=== Test files ===" && (find src app lib -name "*.test.*" -o -name "*.spec.*" -o -name "__tests__" 2>/dev/null | wc -l | tr -d ' ') && echo " test files found"`
!`echo "=== Coverage config ===" && (grep -l "coverage" jest.config.* vitest.config.* package.json 2>/dev/null | head -1 || echo "No coverage config found")`

## Universal Testing Rules

### 1. Test Pyramid
```
         ╱╲
        ╱ E2E ╲         Few, slow, high confidence
       ╱────────╲
      ╱Integration╲     Medium count, moderate speed
     ╱──────────────╲
    ╱   Unit Tests    ╲  Many, fast, focused
   ╱────────────────────╲
```

- **Unit tests**: Every utility, hook, service, pure function → isolated, fast, no I/O
- **Integration tests**: API routes, database queries, component + context → real dependencies
- **E2E tests**: Critical user flows only → login, checkout, search → Playwright/Cypress/Maestro

### 2. When Tests Are Required

**ALWAYS write tests for:**
- New utility functions or helpers
- API routes / Server Actions
- Custom hooks with logic
- Data transformation functions
- State management logic (reducers, stores)
- Auth flows and permission checks
- Payment/financial calculations
- Any function with >2 branches (if/else/switch)

**Tests optional for:**
- Pure UI components with no logic (just layout/styles)
- Config files
- Type definitions
- Simple pass-through wrappers

### 3. Test Structure — AAA Pattern

```typescript
describe('FlightSearchService', () => {
  describe('searchFlights', () => {
    it('should return flights matching origin and destination', async () => {
      // Arrange
      const params = { from: 'IST', to: 'AYT', date: '2025-06-15' };
      const mockFlights = [createMockFlight({ from: 'IST', to: 'AYT' })];
      mockFlightApi.search.mockResolvedValue(mockFlights);

      // Act
      const result = await searchFlights(params);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].origin).toBe('IST');
      expect(result[0].destination).toBe('AYT');
    });

    it('should throw ValidationError for missing destination', async () => {
      // Arrange
      const params = { from: 'IST', date: '2025-06-15' };

      // Act & Assert
      await expect(searchFlights(params)).rejects.toThrow(ValidationError);
    });
  });
});
```

### 4. Naming Conventions
- Test files: `ComponentName.test.tsx` or `service-name.test.ts`
- Describe blocks: component/function name
- It blocks: `should [expected behavior] when [condition]`
- No vague names: ❌ `it('works')` ✅ `it('should return empty array when no flights match')`

### 5. Mocking Strategy

```typescript
// ✅ CORRECT: Mock at the boundary
jest.mock('@/services/flight-api');
const mockFlightApi = jest.mocked(flightApi);

// ✅ CORRECT: Factory function for test data
function createMockFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: 'flight-1',
    origin: 'IST',
    destination: 'AYT',
    price: 1500,
    currency: 'TRY',
    ...overrides,
  };
}

// ❌ WRONG: Mocking implementation details
jest.mock('@/utils/internal-helper'); // Don't mock your own utilities
```

**Mock rules:**
- Mock external dependencies (APIs, databases, third-party services)
- Don't mock your own utility functions — test them directly
- Use factories for test data, not copy-pasted objects
- Reset mocks in `beforeEach` to avoid test pollution
- Prefer `jest.mocked()` over `as jest.MockedFunction<>`

### 6. Edge Cases Checklist

Before marking any function as "tested," verify these edge cases:

**Data inputs:**
- [ ] Empty string / null / undefined
- [ ] Empty array / empty object
- [ ] Boundary values (0, -1, MAX_SAFE_INTEGER)
- [ ] Unicode characters / emoji / RTL text
- [ ] Very long strings (>10K chars)
- [ ] Special characters in user input

**Async operations:**
- [ ] Network timeout / failure
- [ ] Race conditions (concurrent requests)
- [ ] Abort/cancel mid-flight
- [ ] Retry logic paths
- [ ] Empty response from API

**Business logic:**
- [ ] Permission denied scenario
- [ ] Expired session/token
- [ ] Currency conversion edge cases (rounding)
- [ ] Timezone boundaries
- [ ] Pagination last page / empty page

### 7. React Component Testing

```typescript
// ✅ CORRECT: Test behavior, not implementation
import { render, screen, userEvent } from '@testing-library/react';

it('should show search results when form is submitted', async () => {
  const user = userEvent.setup();
  render(<FlightSearch />);

  await user.type(screen.getByLabelText('From'), 'Istanbul');
  await user.click(screen.getByRole('button', { name: /search/i }));

  expect(await screen.findByText(/flights found/i)).toBeInTheDocument();
});

// ❌ WRONG: Testing implementation details
it('should set state', () => {
  const { result } = renderHook(() => useFlightSearch());
  act(() => result.current.setQuery('IST'));
  expect(result.current.query).toBe('IST'); // Testing state, not behavior
});
```

**React testing rules:**
- Query by role, label, text — never by test ID unless no semantic option exists
- Use `userEvent` over `fireEvent` (more realistic)
- Test what the user sees, not internal state
- Use `findBy*` for async content (auto-waits)
- Wrap providers (QueryClient, Theme, Router) in a test utility

### 8. Mobile Testing (React Native)

- Use React Native Testing Library for component tests
- Use Maestro for E2E flows on real devices/simulators
- Test platform-specific behavior: `Platform.OS` branches
- Test offline scenarios: network state changes
- Test deep linking: URL → correct screen with params

### 9. CI Integration

- Tests MUST pass before merge — no exceptions
- Coverage thresholds: ≥70% statements, ≥60% branches (minimum)
- New code should have ≥80% coverage
- Snapshot tests: review diffs carefully, don't blindly update
- Flaky test = broken test — fix immediately, don't retry

### 10. Before Committing Code

Ask yourself:
- [ ] Did I write tests for the new logic?
- [ ] Do tests cover the happy path AND error paths?
- [ ] Are all edge cases from the checklist addressed?
- [ ] Do tests run in isolation (no order dependency)?
- [ ] Would a new developer understand what this test verifies?
