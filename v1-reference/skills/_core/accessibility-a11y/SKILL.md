---
name: accessibility-a11y
description: >
  CORE ACCESSIBILITY LAYER - Auto-invoke when creating or modifying UI components,
  forms, navigation, modals, images, interactive elements, color choices, or any
  user-facing interface. Enforces WCAG 2.1 AA standards, semantic HTML, ARIA
  patterns, keyboard navigation, screen reader support, color contrast, and
  responsive design. Active for all web and mobile projects.
---

# ♿ Accessibility (a11y) — Core Layer

Mandatory accessibility standards. Every user-facing component must be accessible.

## Rules

### 1. Semantic HTML First
- Use correct HTML elements: `<button>` not `<div onClick>`, `<nav>` not `<div class="nav">`
- Heading hierarchy: `h1` → `h2` → `h3` (never skip levels)
- Lists: `<ul>`/`<ol>` for list content, not divs with bullet points
- Tables: `<table>` with `<thead>`, `<th scope>` for tabular data
- Forms: `<label>` linked to every input via `htmlFor`/`id`

```typescript
// ✅ CORRECT
<button onClick={handleSubmit} aria-busy={isLoading}>
  {isLoading ? 'Searching...' : 'Search flights'}
</button>

// ❌ WRONG
<div className="btn" onClick={handleSubmit} role="button">
  Search
</div>
```

### 2. Keyboard Navigation
- **ALL** interactive elements must be keyboard accessible (Tab, Enter, Space, Escape)
- Custom components need `tabIndex`, `onKeyDown` handlers
- Modals: trap focus inside, Escape to close, return focus to trigger on close
- Skip navigation link for main content
- Visible focus indicators — NEVER `outline: none` without replacement

```typescript
// ✅ Focus trap for modal
useEffect(() => {
  if (!isOpen) return;
  const focusable = modalRef.current?.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable?.[0] as HTMLElement;
  const last = focusable?.[focusable.length - 1] as HTMLElement;
  first?.focus();

  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first?.focus();
      }
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [isOpen]);
```

### 3. ARIA Patterns
- Use ARIA only when semantic HTML isn't sufficient
- `aria-label` for elements without visible text (icon buttons)
- `aria-describedby` for form validation errors
- `aria-live="polite"` for dynamic content updates (search results, notifications)
- `aria-expanded` for collapsible sections, dropdowns
- `role="alert"` for error messages, `role="status"` for success messages

```typescript
// ✅ Form with accessible error handling
<div>
  <label htmlFor="email">Email</label>
  <input
    id="email"
    type="email"
    aria-invalid={!!errors.email}
    aria-describedby={errors.email ? 'email-error' : undefined}
  />
  {errors.email && (
    <p id="email-error" role="alert" className="error">
      {errors.email.message}
    </p>
  )}
</div>
```

### 4. Color & Contrast
- **Minimum contrast ratio**: 4.5:1 for normal text, 3:1 for large text (≥18px bold or ≥24px)
- Never use color alone to convey information (add icons, text, patterns)
- Test with color blindness simulators
- Ensure UI works in high contrast mode
- Dark mode: re-verify all contrast ratios

### 5. Images & Media
- ALL images need `alt` text (or `alt=""` for decorative images)
- `alt` describes the image content/purpose, not "image of..."
- Videos: captions required, audio descriptions for important visual content
- SVG: `role="img"` with `<title>` and `<desc>`
- Loading states: use `aria-busy="true"` on the container

```typescript
// ✅ Informative image
<Image src={hotel.photo} alt={`${hotel.name} exterior, ${hotel.city}`} />

// ✅ Decorative image
<Image src="/decorative-pattern.svg" alt="" aria-hidden="true" />

// ❌ WRONG
<Image src={hotel.photo} alt="image" />
<Image src={hotel.photo} /> // missing alt entirely
```

### 6. Forms
- Every input has a visible `<label>`
- Group related fields with `<fieldset>` and `<legend>`
- Error messages: associated via `aria-describedby`, announced with `role="alert"`
- Required fields: `aria-required="true"` + visual indicator
- Auto-complete: use correct `autocomplete` attribute values
- Submit buttons: clear text ("Search flights" not just "Submit")

### 7. Dynamic Content
- Route changes: announce new page title to screen readers
- Loading states: `aria-busy`, skeleton screens with `aria-label`
- Toast notifications: `role="status"` with `aria-live="polite"`
- Infinite scroll: provide a "Load more" button alternative
- Search results: announce count with `aria-live="polite"` region

### 8. Mobile Accessibility (React Native)
- Use `accessible={true}` and `accessibilityLabel` on touchable elements
- `accessibilityRole` for custom components ("button", "link", "header")
- `accessibilityState` for toggles, checkboxes, expandable content
- Minimum touch target: 44x44 points
- Test with VoiceOver (iOS) and TalkBack (Android)

```typescript
// ✅ React Native accessible component
<TouchableOpacity
  accessible={true}
  accessibilityRole="button"
  accessibilityLabel={`Book flight to ${destination}, ${price} ${currency}`}
  accessibilityHint="Opens booking form"
  onPress={handleBook}
  style={{ minWidth: 44, minHeight: 44 }}
>
  <Text>Book</Text>
</TouchableOpacity>
```

### 9. Testing Accessibility
- Automated: `jest-axe`, `@axe-core/react`, Lighthouse a11y audit
- Manual: keyboard-only navigation test, screen reader walkthrough
- Chrome DevTools: Accessibility panel, contrast checker
- Browser extensions: axe DevTools, WAVE

```typescript
// ✅ Automated a11y test
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

it('should have no accessibility violations', async () => {
  const { container } = render(<FlightCard flight={mockFlight} />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

### 10. Checklist Before Shipping
- [ ] All interactive elements keyboard accessible
- [ ] Screen reader announces content logically
- [ ] Color contrast meets WCAG AA (4.5:1 / 3:1)
- [ ] All images have appropriate alt text
- [ ] Forms have labels, error handling, and fieldsets
- [ ] Focus management on modals/drawers/route changes
- [ ] Touch targets ≥ 44x44 on mobile
- [ ] axe/Lighthouse a11y score ≥ 90
