import { NextRequest, NextResponse } from "next/server";
import { dbGunakul, dbConfigured } from "@/lib/server/supabase";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { normalizeIndianPhone } from "@/lib/phone";
import { createOtp, hashOtp, otpExpiry, OTP_TTL_MINUTES } from "@/lib/server/otp";
import { sendOtpSms, smsConfigured } from "@/lib/server/sms";
import { isTestPhone } from "@/lib/server/test-login";

export const runtime = "nodejs";
export const preferredRegion = "bom1";

export async function POST(req: NextRequest) {
  const rl = rateLimit(rateLimitKey(req.headers, null, "otp-request"), 5);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a minute.", retryInSeconds: rl.resetInSeconds },
      { status: 429, headers: { "Retry-After": String(rl.resetInSeconds) } }
    );
  }

  if (!dbConfigured) {
    return NextResponse.json({ error: "Service not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const phone = normalizeIndianPhone(String((body as { phone?: string } | null)?.phone || ""));
  if (!phone) {
    return NextResponse.json(
      { error: "Enter a valid 10-digit Indian mobile number." },
      { status: 400 }
    );
  }
  // Test-login bypass: the configured test number skips SMS entirely and logs
  // in with the fixed LOGIN_TEST_OTP. Just ensure the learner row exists.
  if (isTestPhone(phone)) {
    await dbGunakul
      .from("learners")
      .upsert(
        { phone, name: `Learner ${phone.slice(-4)}`, role: "learner", is_active: true },
        { onConflict: "phone" }
      );
    return NextResponse.json({ ok: true, phone, expiresInMinutes: OTP_TTL_MINUTES, smsSent: false });
  }

  if (process.env.NODE_ENV === "production" && !smsConfigured()) {
    return NextResponse.json({ error: "SMS provider not configured." }, { status: 500 });
  }

  const { error } = await dbGunakul
    .from("learners")
    .upsert(
      { phone, name: `Learner ${phone.slice(-4)}`, role: "learner", is_active: true },
      { onConflict: "phone" }
    );

  if (error) {
    console.error("otp-request learner upsert error:", error);
    return NextResponse.json({ error: "Service error. Try again shortly." }, { status: 502 });
  }

  const otp = createOtp();
  const { error: otpError } = await dbGunakul.from("phone_otps").insert({
    phone,
    otp_hash: hashOtp(phone, otp),
    expires_at: otpExpiry(),
  });

  if (otpError) {
    console.error("otp-request insert error:", otpError);
    return NextResponse.json({ error: "OTP service is not configured." }, { status: 502 });
  }

  try {
    const sms = await sendOtpSms(phone, otp);
    return NextResponse.json({
      ok: true,
      phone,
      expiresInMinutes: OTP_TTL_MINUTES,
      smsSent: sms.sent,
      devOtp: !smsConfigured() && process.env.NODE_ENV !== "production" ? otp : undefined,
    });
  } catch (err) {
    console.error("otp SMS send error:", err);
    return NextResponse.json({ error: "Could not send OTP. Try again shortly." }, { status: 502 });
  }
}
