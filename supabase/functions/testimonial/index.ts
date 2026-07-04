import { serve }        from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SITE_URL       = "https://ctxlabz.com";

serve(async (req) => {
  const sb   = createClient(SUPABASE_URL, SUPABASE_KEY);
  const test = new URL(req.url).searchParams.get("test") === "true";

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: orders, error } = await sb
    .from("orders")
    .select("id, user_email, order_number")
    .in("status", ["payment_processed", "completed"])
    .lte("ordered_at", cutoff);

  if (error) {
    console.error("Orders query error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let toSend = orders || [];

  if (!test && toSend.length) {
    const { data: sent } = await sb.from("review_emails")
      .select("order_id").eq("type", "testimonial");
    const sentIds = new Set((sent || []).map((r: any) => r.order_id));
    toSend = toSend.filter(o => !sentIds.has(o.id));
  }

  if (!toSend.length) return new Response(JSON.stringify({ sent: 0, msg: "No eligible orders" }), { status: 200 });

  let sent = 0;
  for (const order of toSend) {
    if (!order.user_email) continue;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#04090F;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto">
    <div style="padding:24px 28px 20px;border-bottom:3px solid #CC1126">
      <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:1.8rem;letter-spacing:.08em;color:#CC1126">CTXLabz</div>
    </div>
    <div style="background:#0A1829;padding:28px;border:1px solid #112033">
      <h2 style="font-family:'Bebas Neue',Arial,sans-serif;font-size:1.6rem;letter-spacing:.06em;color:#EEF4FF;margin:0 0 12px">How's Your Research Going?</h2>
      <p style="font-size:.9rem;color:#C2DAFF;line-height:1.7;margin:0 0 8px">
        You've been with CTXLabz for a month now. We'd love to know what you think —
        your feedback helps other researchers make informed decisions.
      </p>
      <p style="font-size:.9rem;color:#C2DAFF;line-height:1.7;margin:0 0 24px">Takes less than a minute.</p>
      <a href="${SITE_URL}/testimonials.html?write=1"
         style="display:inline-block;padding:13px 28px;background:#CC1126;color:#fff;
                font-family:'Barlow Condensed',Arial,sans-serif;font-size:.72rem;font-weight:700;
                letter-spacing:.16em;text-transform:uppercase;text-decoration:none;border-radius:2px">
        Leave a Testimonial →
      </a>
    </div>
    <div style="padding:16px 28px;text-align:center;border-top:1px solid #112033">
      <p style="font-size:.72rem;color:#6A8FAD;margin:0">CTXLabz · For research purposes only</p>
    </div>
  </div>
</body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from:    "CTXLabz <noreply@bigboypeps.com>",
        to:      [order.user_email],
        subject: "One month in — how are things going?",
        html,
      }),
    });

    if (res.ok) {
      if (!test) await sb.from("review_emails").insert({ order_id: order.id, type: "testimonial" });
      sent++;
    } else {
      console.error("Resend error:", order.user_email, await res.text());
    }
  }

  return new Response(JSON.stringify({ sent, total: toSend.length, test }), { status: 200 });
});
