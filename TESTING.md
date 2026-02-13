# MEJay Test Suite

## Overview
Comprehensive test suite for MEJay application components, utilities, and stores.

## Running Tests

### All Tests (One Command)
```bash
npm test
```
or with Bun:
```bash
bun test
```

### Watch Mode (for development)
```bash
npm run test:watch
```

### Verbose Output
```bash
npm run test:all
```

### With Coverage
```bash
npm run test:coverage
```

### UI Mode
```bash
npm run test:ui
```

## Test Structure

### Components Tests
- `DevPlanSwitcher.test.tsx` - Dev billing toggle component
- `TabBar.test.tsx` - Tab navigation component
- `NavLink.test.tsx` - Navigation link wrapper

### Store Tests
- `planStore.test.ts` - Plan and billing state management (⏭️ SKIPPED - needs update)
- `djStore.tempoPlan.test.ts` - Tempo planning logic
- `djStore.remove.test.ts` - Track removal logic

### Library Tests
- `utils.test.ts` - Utility functions (cn, etc.)
- `branding.test.ts` - Branding constants
- `checkout.test.ts` - Checkout API integration
- `tempoMatch.test.ts` - Tempo matching algorithms
- `trueEndTime.test.ts` - Audio end time calculation
- `starterPacksPrefs.test.ts` - Starter pack preferences

### Config Tests
- `starterPacks.test.ts` - Starter pack configuration

## Writing New Tests

When creating a new component, create a corresponding `.test.tsx` or `.test.ts` file in the same directory.

### Component Test Template
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { YourComponent } from './YourComponent';

describe('YourComponent', () => {
  it('should render correctly', () => {
    render(<YourComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('should handle user interaction', () => {
    const mockHandler = vi.fn();
    render(<YourComponent onClick={mockHandler} />);
    
    fireEvent.click(screen.getByRole('button'));
    expect(mockHandler).toHaveBeenCalled();
  });
});
```

### Utility Test Template
```ts
import { describe, it, expect } from 'vitest';
import { yourUtility } from './yourUtility';

describe('yourUtility', () => {
  it('should return expected result', () => {
    const result = yourUtility(input);
    expect(result).toBe(expectedOutput);
  });

  it('should handle edge cases', () => {
    expect(yourUtility(null)).toBeUndefined();
  });
});
```

## Test Coverage Goals

Aim for:
- 80%+ code coverage for utilities and business logic
- 70%+ code coverage for components
- 100% coverage for critical payment/auth flows

## Known Issues

- `planStore.test.ts` - Currently skipped due to store structure changes. Tests need to be rewritten to match current Zustand implementation. Skipped with `describe.skip()` to avoid blocking CI/CD.

## CI/CD Integration

Tests run automatically on:
- Pull requests
- Pre-commit hooks (if configured)
- Deployment pipelines

## Troubleshooting

### Common Issues

**Mock not working:**
```ts
vi.mock('./module', () => ({
  exportedFunction: vi.fn(),
}));
```

**React component not rendering:**
- Ensure proper imports from '@testing-library/react'
- Wrap in Router if component uses navigation

**Store state persisting:**
- Reset store state in `beforeEach` hook
- Use `usePlanStore.setState()` to reset

## Best Practices

1. ✅ Test user behavior, not implementation
2. ✅ Use semantic queries (getByRole, getByText)
3. ✅ Mock external dependencies (API calls, stores)
4. ✅ Keep tests independent and isolated
5. ✅ Write descriptive test names
6. ❌ Avoid testing library internals
7. ❌ Don't rely on test execution order
