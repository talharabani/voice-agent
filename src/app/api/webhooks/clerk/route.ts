import { Webhook } from "svix";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type { WebhookEvent } from "@clerk/nextjs/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("CLERK_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "Missing svix headers" },
      { status: 400 }
    );
  }

  const body = await req.text();

  let event: WebhookEvent;
  try {
    const wh = new Webhook(webhookSecret);
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Clerk webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "user.created":
    case "user.updated": {
      const { id, email_addresses, primary_email_address_id, first_name, last_name } =
        event.data;

      const primaryEmail = email_addresses.find(
        (e) => e.id === primary_email_address_id
      )?.email_address;

      if (!primaryEmail) {
        console.error("Clerk webhook: user has no primary email", id);
        break;
      }

      const name = [first_name, last_name].filter(Boolean).join(" ") || null;

      const { error } = await supabaseAdmin.from("users").upsert(
        {
          clerk_id: id,
          email: primaryEmail,
          name,
        },
        { onConflict: "clerk_id" }
      );

      if (error) {
        console.error("Failed to upsert user from Clerk webhook", error);
        return NextResponse.json(
          { error: "Failed to sync user" },
          { status: 500 }
        );
      }
      break;
    }

    case "user.deleted": {
      const { id } = event.data;
      if (id) {
        const { error } = await supabaseAdmin
          .from("users")
          .delete()
          .eq("clerk_id", id);

        if (error) {
          console.error("Failed to delete user from Clerk webhook", error);
        }
      }
      break;
    }

    default:
      // Ignore other event types.
      break;
  }

  return NextResponse.json({ received: true });
}
