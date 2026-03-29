---
description: >
  Apple App Store compliance rules for the Avenas app. Use this file whenever
  the user asks to check if the app is ready for submission, if something might
  cause a rejection, or when building any feature that touches privacy,
  payments, permissions, user accounts, or content. Run through the checklist
  at the bottom before every submission.
---

# Apple App Store Compliance — Avenas

## How to Use This File

When the user says things like:
- "check if we are ready to submit"
- "will Apple reject this?"
- "is there anything missing before I submit?"
- "do an App Store compliance check"

Read this entire file and audit the current codebase against every section.
Report exactly what is present, what is missing, and what needs fixing before
submission. Be specific — don't just say "add a privacy policy", say where it
needs to appear and what it needs to contain.

---

## 1. Performance & Stability (Guideline 2.1)
**#1 cause of rejection — over 40% of all rejections**

- [ ] App does not crash on launch
- [ ] App does not crash during any core user flow
- [ ] All navigation links and buttons work — no dead ends
- [ ] App handles no internet connection gracefully (shows error, doesn't crash)
- [ ] App handles empty states (no data to show) — never a blank screen
- [ ] No placeholder text (Lorem Ipsum, "coming soon", dummy data) in the build
- [ ] All features described in the App Store listing actually work
- [ ] App has been tested on a physical iPhone, not just a simulator
- [ ] If the app requires login, a working demo account must be provided in App Review Notes

**React Native / Expo specific:**
- Wrap all async operations in try/catch with user-facing error states
- Use `ErrorBoundary` components to catch unexpected render errors
- Test on multiple iPhone screen sizes before submitting

---

## 2. Privacy & Data Collection (Guideline 5.1)
**Leading cause of rejection in 2025**

- [ ] Privacy policy exists at a publicly accessible URL
- [ ] Privacy policy URL is entered in App Store Connect
- [ ] Privacy policy is accessible from within the app (e.g. Settings screen)
- [ ] Privacy policy explains exactly what data is collected and why
- [ ] App only requests permissions it actually needs — no extras
- [ ] Every permission request has a clear, specific purpose string in `app.json` (not vague like "This app needs access")
- [ ] Users can revoke data consent at any time
- [ ] All data transmitted over HTTPS — no plain HTTP calls
- [ ] If using third-party SDKs (analytics, crash reporting), their data collection is disclosed in the privacy policy

**Permission purpose strings must be set in app.json:**
```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSCameraUsageDescription": "Avenas uses your camera to [specific reason]",
        "NSPhotoLibraryUsageDescription": "Avenas accesses your photos to [specific reason]",
        "NSLocationWhenInUseUsageDescription": "Avenas uses your location to [specific reason]"
      }
    }
  }
}
```
Only include permissions the app actually uses. Each string must be specific and honest.

**AI & Third-party data sharing (2025 rule):**
- If any AI feature shares user data with a third-party AI service, this must be disclosed to the user and require explicit consent before it happens

---

## 3. User Accounts & Account Deletion (Guideline 5.1.1)

- [ ] If the app allows account creation, it must also allow account deletion from within the app
- [ ] Account deletion must be a clear in-app option — "email us to delete" is not acceptable
- [ ] If the app requires login to access core features, provide demo credentials in App Review Notes

---

## 4. In-App Purchases & Payments (Guideline 3.1.1)

- [ ] Any digital content, features, or subscriptions sold inside the app use Apple's StoreKit (IAP)
- [ ] No links or buttons directing users to purchase on an external website for digital goods
- [ ] Prices are clearly shown before purchase — no hidden fees
- [ ] A "Restore Purchases" button exists wherever the paywall or purchase options appear
- [ ] Subscription terms (price, duration, renewal) are visible before the user confirms
- [ ] Sandbox purchase testing completed before submission

**If the app has NO purchases:** confirm this is the case and no payment flows exist.

---

## 5. App Metadata & Store Listing (Guideline 2.3)

- [ ] App name is accurate and not misleading
- [ ] App description matches what the app actually does — no promised features that don't exist yet
- [ ] Screenshots show the actual app UI — not mockups or marketing images
- [ ] Screenshots provided for required iPhone sizes (6.9" and 6.5" at minimum)
- [ ] App icon meets Apple's requirements: no alpha channel, correct sizes, no rounded corners (Apple applies these)
- [ ] No placeholder icons or default Expo icons in the build
- [ ] Age rating is set correctly in App Store Connect
- [ ] Category is set correctly

**Expo / app.json requirements:**
```json
{
  "expo": {
    "name": "Avenas",
    "slug": "avenas",
    "version": "1.0.0",
    "icon": "./assets/icon.png",
    "splash": { "image": "./assets/splash.png" },
    "ios": {
      "bundleIdentifier": "com.yourname.avenas",
      "buildNumber": "1"
    }
  }
}
```

---

## 6. Design & User Experience (Guideline 4.2)

- [ ] App is not just a website wrapped in a WebView — it has genuine native functionality
- [ ] App supports Dark Mode (or handles it gracefully without breaking layout)
- [ ] App supports Dynamic Type (text scaling) — don't hardcode font sizes that break at large text settings
- [ ] App works correctly on iPad — Apple tests on iPad even if the app doesn't target it
- [ ] No spelling or grammatical errors in the UI
- [ ] No broken layouts on any supported screen size
- [ ] Navigation is intuitive — reviewers should not need instructions to use the app

---

## 7. User-Generated Content (Guideline 1.2)
*Only applies if users can post, comment, upload, or message*

- [ ] Every piece of user content has a "Report" button
- [ ] Every user profile has a "Block user" option
- [ ] A moderation system exists (even a basic manual queue)
- [ ] Contact/support information is accessible in the app
- [ ] Automated keyword filtering for obviously inappropriate content

---

## 8. Objectionable Content (Guideline 1.1)

- [ ] No explicit, violent, or discriminatory content
- [ ] No content that encourages dangerous or illegal behaviour
- [ ] Age rating in App Store Connect accurately reflects the content

---

## 9. Technical Requirements (Guideline 2.5)

- [ ] App is built with Xcode 26+ (via EAS Build — this is handled automatically if using latest Expo SDK)
- [ ] Targets iOS 16+ at minimum (iOS 18+ recommended)
- [ ] App does not use private or undocumented Apple APIs
- [ ] App does not alter native iOS UI elements or system behaviours (volume buttons, silent switch etc.)
- [ ] All required app icons and splash screens are present at correct sizes
- [ ] Bundle identifier matches what is registered in App Store Connect

---

## 10. Legal (Guideline 5.2 & 5.3)

- [ ] App does not use copyrighted content (images, music, text) without permission
- [ ] App does not use another app's icon, name, or brand without approval
- [ ] App does not infringe on any trademarks
- [ ] If app operates in a regulated industry (health, finance, legal), appropriate disclaimers are present

---

## Pre-Submission Checklist — Run This Every Time

Before telling the user the app is ready to submit, verify ALL of the following:

```
STABILITY
[ ] Tested on physical iPhone — no crashes
[ ] All flows work end to end
[ ] No placeholder content anywhere
[ ] Error states exist for network failures

PRIVACY
[ ] Privacy policy URL in App Store Connect
[ ] Privacy policy accessible in-app
[ ] All permission strings set in app.json
[ ] Only necessary permissions requested

ACCOUNTS
[ ] Account deletion available in-app (if accounts exist)
[ ] Demo credentials prepared for reviewer (if login required)

PAYMENTS
[ ] All digital purchases go through StoreKit IAP
[ ] Restore Purchases button present
[ ] No external payment links for digital goods

METADATA
[ ] Screenshots show real app UI
[ ] Description matches actual features
[ ] App icon is final (not default Expo icon)
[ ] Age rating set correctly

TECHNICAL
[ ] Bundle identifier correct
[ ] Version and build numbers updated
[ ] Built with latest EAS Build
[ ] Tested on iPad (at least on simulator)

DESIGN
[ ] Dark mode doesn't break layouts
[ ] No spelling errors in UI
[ ] App works on all iPhone screen sizes
```

---

## When Apple Rejects the App

1. Read the rejection reason fully in App Store Connect Resolution Center
2. Identify the exact guideline number they cited
3. Fix the root cause — do not patch the symptom
4. Reply in Resolution Center with a brief note explaining what was changed and where to find it
5. Increment the build number before resubmitting
6. Do not appeal unless you genuinely believe the rejection was wrong — fixing and resubmitting is faster

---

## Reference Links
- Apple App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- App Store Connect: https://appstoreconnect.apple.com
- Expo App Store best practices: https://docs.expo.dev/distribution/app-stores/
- Apple Privacy Nutrition Labels: https://developer.apple.com/app-store/app-privacy-details/
