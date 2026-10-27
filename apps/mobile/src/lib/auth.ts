import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import type { QueryClient } from "@tanstack/react-query";
import { keys } from "@golaly/client";
import type { AppSession, LoginInput, RegisterInput } from "@golaly/shared";
import { config } from "./config";
import { setLocale } from "./i18n";
import { api, currentRefreshToken, deviceToken, endSession, startSession } from "./session";

/** Which sign-in buttons to show: the API says what it accepts, the build says what it can do. */
export interface Providers {
  google: boolean;
  apple: boolean;
}

export async function availableProviders(): Promise<Providers> {
  const server = await api.get<Providers>("/auth/app/providers").catch(() => ({ google: false, apple: false }));
  const appleHere = Platform.OS === "ios" && (await AppleAuthentication.isAvailableAsync().catch(() => false));
  const googleHere = !!config.googleWebClientId && (Platform.OS === "android" || !!config.googleIosClientId);
  return { google: server.google && googleHere, apple: server.apple && appleHere };
}

async function begin(qc: QueryClient, s: AppSession) {
  await startSession(s);
  setLocale(s.user.locale);
  qc.setQueryData(keys.me, s.user);
  return s;
}

export async function logIn(qc: QueryClient, input: LoginInput) {
  return begin(qc, await api.post<AppSession>("/auth/app/login", { ...input, deviceToken: (await deviceToken()) ?? undefined }));
}

export async function register(qc: QueryClient, input: RegisterInput) {
  return begin(qc, await api.post<AppSession>("/auth/app/register", input));
}

/** null = the person closed the Google sheet. Needs a development build (the native module isn't in Expo Go). */
export async function logInWithGoogle(qc: QueryClient): Promise<AppSession | null> {
  const { GoogleSignin, isSuccessResponse } = await import("@react-native-google-signin/google-signin");
  GoogleSignin.configure({ webClientId: config.googleWebClientId, iosClientId: config.googleIosClientId });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  if (!isSuccessResponse(res) || !res.data.idToken) return null;
  // Only the ID token goes to Golaly; the Google session on the phone isn't needed afterwards.
  await GoogleSignin.signOut().catch(() => undefined);
  return begin(qc, await api.post<AppSession>("/auth/app/google", { idToken: res.data.idToken, deviceToken: (await deviceToken()) ?? undefined }));
}

/** null = cancelled. The raw nonce goes to Golaly, its SHA-256 to Apple: the API checks they match. */
export async function logInWithApple(qc: QueryClient): Promise<AppSession | null> {
  const nonce = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
  } catch (e) {
    if ((e as { code?: string }).code === "ERR_REQUEST_CANCELED") return null;
    throw e;
  }
  if (!credential.identityToken) return null;
  // Apple shares the name only on the very first sign-in.
  const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(" ") || undefined;
  return begin(qc, await api.post<AppSession>("/auth/app/apple", { identityToken: credential.identityToken, nonce, name, deviceToken: (await deviceToken()) ?? undefined }));
}

/** Ends the session on the server (which also stops this phone's notifications) and forgets it here. */
export async function logOut(qc: QueryClient) {
  await api.post("/auth/app/logout", { refreshToken: currentRefreshToken() ?? undefined }).catch(() => undefined);
  await endSession();
  qc.clear();
}
