import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.56.0';
import webpush from 'npm:web-push@3.6.7';

type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  reminders: string[];
  mention_user_ids: string[];
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  is_active: boolean;
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
const cronSecret = Deno.env.get('CRON_SECRET');

if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
  throw new Error('Missing required environment variables for send-reminders function');
}

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  }

  if (cronSecret) {
    const received = req.headers.get('x-cron-secret');
    if (received !== cronSecret) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }
  }

  const now = new Date();
  const lower = new Date(now.getTime() - 90_000);
  const upper = new Date(now.getTime() + 30_000);

  const [{ data: eventsData, error: eventsError }, { data: subsData, error: subsError }] = await Promise.all([
    supabase.from('events').select('id,title,starts_at,reminders,mention_user_ids').neq('reminders', '{}'),
    supabase.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth,is_active').eq('is_active', true),
  ]);

  if (eventsError) {
    return new Response(JSON.stringify({ error: eventsError.message }), { status: 500 });
  }
  if (subsError) {
    return new Response(JSON.stringify({ error: subsError.message }), { status: 500 });
  }

  const events = (eventsData ?? []) as EventRow[];
  const subscriptions = (subsData ?? []) as SubscriptionRow[];
  const subscriptionsByUser = new Map<string, SubscriptionRow[]>();

  for (const sub of subscriptions) {
    const current = subscriptionsByUser.get(sub.user_id) ?? [];
    current.push(sub);
    subscriptionsByUser.set(sub.user_id, current);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const event of events) {
    for (const reminderIso of event.reminders ?? []) {
      const reminderAt = new Date(reminderIso);
      if (Number.isNaN(reminderAt.getTime()) || reminderAt < lower || reminderAt > upper) {
        continue;
      }

      const recipients =
        event.mention_user_ids && event.mention_user_ids.length > 0
          ? event.mention_user_ids.flatMap((id) => subscriptionsByUser.get(id) ?? [])
          : subscriptions;

      const uniqueRecipients = new Map<string, SubscriptionRow>();
      for (const recipient of recipients) {
        uniqueRecipients.set(recipient.id, recipient);
      }

      for (const subscription of uniqueRecipients.values()) {
        const dispatchKey = `${event.id}:${reminderIso}:${subscription.id}`;
        const { error: lockError } = await supabase.from('push_dispatch_log').insert({
          dispatch_key: dispatchKey,
          user_id: subscription.user_id,
          event_id: event.id,
          reminder_at: reminderIso,
        });

        if (lockError) {
          skipped += 1;
          continue;
        }

        const dayIso = event.starts_at.slice(0, 10);
        const url = `/?page=calendar&date=${encodeURIComponent(dayIso)}&eventId=${encodeURIComponent(event.id)}`;
        const payload = JSON.stringify({
          title: 'Planest Reminder',
          body: `Evento: ${event.title}`,
          page: 'calendar',
          date: dayIso,
          eventId: event.id,
          url,
        });

        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            payload,
          );
          sent += 1;
        } catch (error) {
          failed += 1;
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await supabase
              .from('push_subscriptions')
              .update({ is_active: false, updated_at: new Date().toISOString() })
              .eq('id', subscription.id);
          }
        }
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      now: now.toISOString(),
      sent,
      skipped,
      failed,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
