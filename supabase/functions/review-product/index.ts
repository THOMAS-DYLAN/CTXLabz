import { serve }        from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SITE_URL       = "https://ctxlabz.com";

serve(async (req) => {
  const sb   = createClient(SUPABASE_URL, SUPABASE_KEY);
  const test = new URL(req.url).searchParams.get("test") === "true";

  const upperCutoff = new Date(Date.now() - (test ? 0 : 10) * 24 * 60 * 60 * 1000).toISOString();
  const lowerCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch orders in the window
  const { data: orders, error } = await sb
    .from("orders")
    .select("id, user_email, items, order_number")
    .in("status", ["payment_processed", "completed"])
    .lte("ordered_at", upperCutoff)
    .gte("ordered_at", lowerCutoff);

  if (error) {
    console.error("Orders query error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let toSend = orders || [];

  // Filter already-sent (skip in test mode)
  if (!test && toSend.length) {
    const { data: sent } = await sb.from("review_emails")
      .select("order_id").eq("type", "review-product");
    const sentIds = new Set((sent || []).map((r: any) => r.order_id));
    toSend = toSend.filter(o => !sentIds.has(o.id));
  }

  if (!toSend.length) return new Response(JSON.stringify({ sent: 0, msg: "No eligible orders" }), { status: 200 });

  let sent = 0;
  for (const order of toSend) {
    if (!order.user_email) continue;
    const items: { id: number; name: string }[] = Array.isArray(order.items) ? order.items : [];
    if (!items.length) continue;

    const productButtons = items.map(item =>
      `<a href="${SITE_URL}/product.html?id=${item.id}#reviews"
         style="display:inline-block;margin:6px 6px 0 0;padding:10px 18px;background:#CC1126;color:#fff;
                font-family:'Barlow Condensed',Arial,sans-serif;font-size:.7rem;font-weight:700;
                letter-spacing:.12em;text-transform:uppercase;text-decoration:none;border-radius:2px">
         Review ${item.name} →
       </a>`
    ).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff">
    <div style="background:#04090F;padding:24px 28px;border-bottom:3px solid #CC1126">
      <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:1.8rem;letter-spacing:.08em;color:#CC1126">CTXLabz</div>
    </div>
    <div style="padding:28px">
      <p style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:.6rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#CC1126;margin:0 0 8px">Order #${order.order_number}</p>
      <h2 style="font-family:'Bebas Neue',Arial,sans-serif;font-size:1.6rem;letter-spacing:.06em;color:#111;margin:0 0 12px">How Was Your Order?</h2>
      <p style="font-size:.9rem;color:#444;line-height:1.7;margin:0 0 20px">
        You've had your compounds for a while — we'd love to hear how your research is going.
        Click a product below to leave a quick review.
      </p>
      ${productButtons}
    </div>
    <div style="background:#f6f6f6;border-top:1px solid #eee;padding:16px 28px;text-align:center">
      <p style="font-size:.75rem;color:#999;margin:0">CTXLabz · For research purposes only · Not for human consumption</p>
    </div>
  </div>
</body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from:    "CTXLabz <noreply@bigboypeps.com>",
        to:      [order.user_email],
        subject: "How was your order? Leave a product review",
        html,
      }),
    });

    if (res.ok) {
      if (!test) await sb.from("review_emails").insert({ order_id: order.id, type: "review-product" });
      sent++;
    } else {
      console.error("Resend error:", order.user_email, await res.text());
    }
  }

  return new Response(JSON.stringify({ sent, total: toSend.length, test }), { status: 200 });
});
