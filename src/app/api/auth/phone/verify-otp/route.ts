import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { dbGunakul, dbConfigured } from "@/lib/server/supabase";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { normalizeIndianPhone } from "@/lib/phone";
import { setLearnerCookie } from "@/lib/server/phone-auth";
import { hashOtp, isOtpFormat } from "@/lib/server/otp";
import { isTestLogin } from "@/lib/server/test-login";

export const runtime = "nodejs";
export const preferredRegion = "bom1";

export async function POST(req: NextRequest) {
  const rl = rateLimit(rateLimitKey(req.headers, null, "otp-verify"), 10);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a minute.", retryInSeconds: rl.resetInSeconds },
      { status: 429, headers: { "Retry-After": String(rl.resetInSeconds) } }
    );
  }

  if (!dbConfigured) {
    return NextResponse.json({ error: "Service not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const phone = normalizeIndianPhone(String((body as { phone?: string } | null)?.phone || ""));
  const otp = String((body as { otp?: string } | null)?.otp || "").replace(/\D/g, "");

  if (!phone) return NextResponse.json({ error: "Invalid phone number." }, { status: 400 });
  if (!isOtpFormat(otp)) return NextResponse.json({ error: "Enter the 6-digit OTP." }, { status: 400 });

  // Test-login bypass: the configured test number + fixed LOGIN_TEST_OTP skips
  // the SMS/DB OTP check entirely. Off unless both env vars are set.
  const bypass = isTestLogin(phone, otp);
  let otpRowId: string | null = null;

  if (!bypass) {
    const { data: otpRow, error: otpLookupError } = await dbGunakul
      .from("phone_otps")
      .select("id, otp_hash, attempts, expires_at, consumed_at")
      .eq("phone", phone)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpLookupError) {
      console.error("otp lookup error:", otpLookupError);
      return NextResponse.json({ error: "OTP service is not configured." }, { status: 502 });
    }

    if (!otpRow) {
      return NextResponse.json({ error: "OTP expired. Request a new OTP." }, { status: 401 });
    }

    const attempts = Number((otpRow as { attempts?: number }).attempts || 0);
    if (attempts >= 5) {
      return NextResponse.json({ error: "Too many wrong attempts. Request a new OTP." }, { status: 401 });
    }

    const expected = String((otpRow as { otp_hash: string }).otp_hash || "");
    const actual = hashOtp(phone, otp);
    const valid = expected.length === actual.length &&
      cryptoSafeEqual(expected, actual);

    if (!valid) {
      await dbGunakul
        .from("phone_otps")
        .update({ attempts: attempts + 1 })
        .eq("id", (otpRow as { id: string }).id);
      return NextResponse.json({ error: "Incorrect OTP. Try again." }, { status: 401 });
    }

    otpRowId = (otpRow as { id: string }).id;
  }

  const { data, error } = await dbGunakul
    .from("learners")
    .upsert(
      {
        phone,
        name: `Learner ${phone.slice(-4)}`,
        role: "learner",
        is_active: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "phone" }
    )
    .select("id, phone, name, role, preferred_lang")
    .single();

  if (error || !data) {
    console.error("otp-verify learner upsert error:", error);
    return NextResponse.json({ error: "Service error. Try again shortly." }, { status: 502 });
  }

  const roleSlug = (data.role as string) || "learner";
  const isAdmin = roleSlug === "founder" || roleSlug === "admin";
  const session = {
    learnerId: data.id as string,
    phone: data.phone as string,
    name: (data.name as string) || "",
    roleSlug,
    categorySlug: "electrician",
    isAdmin,
  };

  const res = NextResponse.json({
    ok: true,
    learner: {
      id: session.learnerId,
      phone: session.phone,
      name: session.name,
      role: roleSlug,
      isAdmin,
      preferredLang: (data.preferred_lang as string) || "en",
    },
  });
  if (otpRowId) {
    await dbGunakul
      .from("phone_otps")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", otpRowId);
  }
  setLearnerCookie(res, session);
  return res;
}

function cryptoSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}
