import "server-only";
import { normalizeIndianPhone } from "@/lib/phone";

/**
 * Guarded test-login bypass. Lets ONE phone number log in with a fixed OTP,
 * skipping SMS — useful for testing the deployment before a real SMS provider
 * (MSG91 / Twilio) is configured.
 *
 * Off by default: only active when BOTH env vars are set.
 *   LOGIN_TEST_PHONE  e.g. 9876543210   (the single allowed test number)
 *   LOGIN_TEST_OTP    e.g. 123456        (the fixed code that always works)
 *
 * Remove these env vars (or unset them) to disable before public launch.
 */

/** Normalised test phone (+91…) if the bypass is enabled, else null. */
export function testLoginPhone(): string | null {
  const phoneRaw = process.env.LOGIN_TEST_PHONE?.trim();
  const otp = process.env.LOGIN_TEST_OTP?.trim();
  if (!phoneRaw || !otp) return null;
  return normalizeIndianPhone(phoneRaw);
}

/** True if `phone` is the configured test number (request stage — no OTP yet). */
export function isTestPhone(phone: string): boolean {
  const tp = testLoginPhone();
  return tp !== null && phone === tp;
}

/** True if `phone` + `otp` match the configured test credentials. */
export function isTestLogin(phone: string, otp: string): boolean {
  const tp = testLoginPhone();
  const expected = process.env.LOGIN_TEST_OTP?.trim();
  return tp !== null && !!expected && phone === tp && otp === expected;
}
