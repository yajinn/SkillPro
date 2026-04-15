---
name: react-native-conventions
description: >
  React Native project conventions. Auto-invoke when working on React Native
  projects (CLI or Expo): native modules, navigation, performance, platform-specific
  code, OTA updates, app signing, WebView security, Hermes engine, bridge
  communication, native linking, Gradle/Xcode configs, or RN version migration.
---

# 📱 React Native Conventions — Project Layer

Project-specific rules for React Native applications.

## Project Detection

!`echo "=== RN Version ===" && jq -r '.dependencies["react-native"] // "unknown"' package.json 2>/dev/null`
!`echo "=== Type ===" && ([ -f "app.json" ] && grep -q "expo" app.json 2>/dev/null && echo "Expo" || echo "CLI")`
!`echo "=== Hermes ===" && (grep -q "hermesEnabled" android/app/build.gradle 2>/dev/null && echo "Hermes enabled" || echo "Check manually")`
!`echo "=== Pods ===" && ([ -f "ios/Podfile.lock" ] && echo "Pods: $(grep -c "^  -" ios/Podfile.lock 2>/dev/null) installed" || echo "No Podfile.lock")`

## Architecture Rules

### 1. Critical File Protection 🚨
**STOP and request approval before modifying:**
- `android/app/build.gradle` — affects Android build
- `ios/*.xcodeproj` / `ios/*.pbxproj` — affects iOS build
- `Podfile` — affects iOS native dependencies
- `react-native.config.js` — affects native module linking
- `metro.config.js` — affects bundler behavior
- `babel.config.js` — affects code transformation
- `app.json` / `app.config.js` — affects app identity

### 2. Performance Rules
- Use `FlatList` / `SectionList` instead of `ScrollView` for lists > 20 items
- Implement `keyExtractor` on ALL lists — never use index as key
- Use `React.memo` for list item components
- Avoid inline styles in loops — extract to `StyleSheet.create()`
- Use `useNativeDriver: true` for animations
- Minimize bridge crossings — batch native calls where possible

```typescript
// ✅ CORRECT: Optimized FlatList
const renderItem = useCallback(({ item }: { item: Flight }) => (
  <FlightCard flight={item} />
), []);

<FlatList
  data={flights}
  renderItem={renderItem}
  keyExtractor={(item) => item.id}
  getItemLayout={(_, index) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * index,
    index,
  })}
  windowSize={5}
  maxToRenderPerBatch={10}
  removeClippedSubviews={true}
/>
```

### 3. Navigation
- Use React Navigation v6+ with typed routes
- Implement deep linking configuration
- Lazy load screens: `React.lazy()` or navigation lazy loading
- Handle back button on Android properly
- Persist navigation state for app resume

### 4. Platform-Specific Code
```typescript
// ✅ File-based: Component.ios.tsx / Component.android.tsx
// ✅ Inline: Platform.select({ ios: styles.ios, android: styles.android })
// ✅ Conditional: if (Platform.OS === 'ios') { ... }
```
- Test on BOTH platforms — never assume parity
- Use `Platform.Version` for OS version checks
- Huawei: handle HMS vs GMS gracefully

### 5. Security
- **WebView**: Use `originWhitelist`, disable `javaScriptEnabled` if not needed
- **Storage**: Use `react-native-keychain` for sensitive data, never AsyncStorage
- **SSL Pinning**: Implement for critical API endpoints
- **Code Signing**: Verify app integrity with attestation (SafetyNet/App Attest)
- **ProGuard/R8**: Enable for Android release builds
- **Jailbreak/Root Detection**: Implement for financial apps

### 6. OTA Updates
- After App Center shutdown, evaluate alternatives:
  - `react-native-ota-hot-update` (self-hosted)
  - `Revopush`
  - Expo Updates (if using Expo)
  - Custom solution with CDN + version checking
- **NEVER** OTA-update native module changes — requires store release
- Test OTA updates on real devices before production rollout

### 7. Version Migration
For major RN version upgrades:
1. Read the release changelog completely
2. Use `npx react-native upgrade` as starting point
3. Check React Native Upgrade Helper (react-native-community/rn-diff-purge)
4. Update native dependencies (Pods, Gradle) separately
5. Test on BOTH platforms after each step
6. **NEVER** skip versions — migrate incrementally

### 8. Native Module Guidelines
- Prefer existing community packages over custom native modules
- If custom module needed: implement for both platforms
- Use New Architecture (TurboModules, Fabric) for new modules
- Bridge calls are async — never assume synchronous execution
- Test native crashes with Crashlytics or Sentry
