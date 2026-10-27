# Golaly mobile (iOS + Android)

Expo SDK 58 · React Native 0.88 · expo-router. Talks to the same API as the web and shares its non-UI code:

| From | What |
|---|---|
| `@golaly/client` | typed API client (Bearer tokens here, cookies on the web), query keys, the TanStack Query hooks |
| `@golaly/shared` | types, validation schemas, translated API messages |
| `@golaly/tokens` | Atlas colours (light + dark), day colours, radii |

What's in it so far: sign in (email + password, Google, Apple), create an account, my trips, a trip's itinerary
(read-only), push notifications that open the trip they're about. Next: today / "where to now", marking stops,
expenses — the on-trip features.

## Run it

```bash
npm install                      # at the repo root (workspaces)
cp apps/mobile/.env.example apps/mobile/.env
# EXPO_PUBLIC_GOLALY_URL=http://<your computer's LAN IP>:3000  — and `npm run dev` at the root
npm run mobile                   # = expo start; scan the QR code with Expo Go (Android) or the Camera (iOS)
```

Expo Go runs password sign-in and the screens. **Google sign-in, Sign in with Apple and push notifications need a
development build** (native modules / entitlements that Expo Go doesn't have):

```bash
npm install -g eas-cli && eas login
cd apps/mobile && eas init       # creates the Expo project; put its id in EXPO_PUBLIC_EAS_PROJECT_ID
eas build --profile development --platform android   # or ios (needs an Apple Developer account)
```

Without a Mac you never need Xcode: EAS builds in the cloud.

## Sign-in setup

- **API**: the `/api/v1/auth/app/*` endpoints and `push/devices` (see the root README → *the mobile app's sign-in
  and push*). Set `GOOGLE_APP_CLIENT_IDS`, `APPLE_CLIENT_IDS=com.golaly.app` and `PUSH_DRIVER=expo` on the API.
- **Google**: in Google Cloud Console create an *iOS* OAuth client (bundle id `com.golaly.app`) and an *Android* one
  (package `com.golaly.app` + the SHA-1 of the signing key, from `eas credentials`). The app signs in with the
  **web** client id (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`) and, on iOS, the iOS client id.
- **Apple**: enable *Sign in with Apple* for the app id in the Apple Developer portal (EAS does it when it creates
  the app id). The App Store requires it because Google sign-in is offered.

## Checks

```bash
npm run typecheck -w @golaly/mobile
npm run export:check -w @golaly/mobile    # bundles the JS for Android with Metro (catches resolution errors)
```

Tokens are kept in the iOS Keychain / Android Keystore (expo-secure-store). Signing out ends the session on the
server, which also stops this phone's notifications.
