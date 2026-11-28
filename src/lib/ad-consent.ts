import { applySignals, canTrack, readChoice } from "@/lib/consent";

export function explicitAdAcceptance(): boolean {
  return readChoice("advertising") === "granted";
}

export function permitsOrdinaryAds(): Promise<boolean> {
  return canTrack("advertising");
}

export function updateGoogleAdConsent(decision: "granted" | "denied"): void {
  if (readChoice("advertising") === "denied") decision = "denied";
  applySignals("advertising", decision);
}