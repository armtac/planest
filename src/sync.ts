import { db } from './db';
import { isSupabaseEnabled, supabase } from './supabase';
import type { CalendarEvent, Mutation, PlanAction, PlanItem, PriorityCategory, UserProfile } from './types';

type SyncTable = 'categories' | 'items' | 'actions' | 'events' | 'profiles';

type RemoteCategory = {
  id: string;
  title: string;
  owner: string;
  owner_user_id: string | null;
  color: string;
  color_name: string | null;
  created_at: string;
  updated_at: string;
};

type RemoteItem = {
  id: string;
  category_id: string;
  title: string;
  note: string;
  mention_user_ids: string[];
  created_at: string;
  updated_at: string;
};

type RemoteAction = {
  id: string;
  item_id: string;
  title: string;
  percent_complete: number;
  due_date: string | null;
  reminders: string[];
  mention_user_ids: string[];
  created_at: string;
  updated_at: string;
};

type RemoteEvent = {
  id: string;
  category_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  recurrence_rule: string | null;
  exception_dates: string[];
  reminders: string[];
  mention_user_ids: string[];
  color: string;
  color_name: string | null;
  attachment_name: string | null;
  attachment_data_url: string | null;
  created_at: string;
  updated_at: string;
};

type RemoteProfile = {
  id: string;
  email: string | null;
  display_name: string;
  created_at: string;
  updated_at: string;
};

const tableNames: SyncTable[] = ['categories', 'items', 'actions', 'events', 'profiles'];

const toRemote = (table: SyncTable, payload: Record<string, unknown>) => {
  if (table === 'categories') {
    const data = payload as PriorityCategory;
    const remote: RemoteCategory = {
      id: data.id,
      title: data.title,
      owner: data.owner,
      owner_user_id: data.ownerUserId,
      color: data.color,
      color_name: data.colorName,
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    return remote;
  }

  if (table === 'items') {
    const data = payload as PlanItem;
    const remote: RemoteItem = {
      id: data.id,
      category_id: data.categoryId,
      title: data.title,
      note: data.note,
      mention_user_ids: data.mentionUserIds,
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    return remote;
  }

  if (table === 'actions') {
    const data = payload as PlanAction;
    const remote: RemoteAction = {
      id: data.id,
      item_id: data.itemId,
      title: data.title,
      percent_complete: data.percentComplete,
      due_date: data.dueDate,
      reminders: data.reminders,
      mention_user_ids: data.mentionUserIds,
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    return remote;
  }

  if (table === 'profiles') {
    const profile = payload as UserProfile;
    const remoteProfile: RemoteProfile = {
      id: profile.id,
      email: profile.email,
      display_name: profile.displayName,
      created_at: profile.createdAt,
      updated_at: profile.updatedAt,
    };
    return remoteProfile;
  }

  const data = payload as CalendarEvent;
  const remote: RemoteEvent = {
    id: data.id,
    category_id: data.categoryId,
    title: data.title,
    starts_at: data.startsAt,
    ends_at: data.endsAt,
    recurrence_rule: data.recurrenceRule,
    exception_dates: data.exceptionDates,
    reminders: data.reminders,
    mention_user_ids: data.mentionUserIds,
    color: data.color,
    color_name: data.colorName,
    attachment_name: data.attachmentName,
    attachment_data_url: data.attachmentDataUrl,
    created_at: data.createdAt,
    updated_at: data.updatedAt,
  };
  return remote;
};

const toLocal = (table: SyncTable, payload: Record<string, unknown>) => {
  if (table === 'categories') {
    const data = payload as RemoteCategory;
    const local: PriorityCategory = {
      id: data.id,
      title: data.title,
      owner: data.owner,
      ownerUserId: data.owner_user_id,
      color: data.color,
      colorName: data.color_name ?? null,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
    return local;
  }

  if (table === 'items') {
    const data = payload as RemoteItem;
    const local: PlanItem = {
      id: data.id,
      categoryId: data.category_id,
      title: data.title,
      note: data.note,
      mentionUserIds: data.mention_user_ids ?? [],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
    return local;
  }

  if (table === 'actions') {
    const data = payload as RemoteAction;
    const local: PlanAction = {
      id: data.id,
      itemId: data.item_id,
      title: data.title,
      percentComplete: data.percent_complete,
      dueDate: data.due_date,
      reminders: data.reminders,
      mentionUserIds: data.mention_user_ids ?? [],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
    return local;
  }

  if (table === 'profiles') {
    const profile = payload as RemoteProfile;
    const localProfile: UserProfile = {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    };
    return localProfile;
  }

  const data = payload as RemoteEvent;
  const local: CalendarEvent = {
    id: data.id,
    categoryId: data.category_id,
    title: data.title,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    recurrenceRule: data.recurrence_rule,
    exceptionDates: data.exception_dates ?? [],
    reminders: data.reminders,
    mentionUserIds: data.mention_user_ids ?? [],
    color: data.color,
    colorName: data.color_name ?? null,
    attachmentName: data.attachment_name,
    attachmentDataUrl: data.attachment_data_url,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
  return local;
};

export const enqueueMutation = async (mutation: Mutation): Promise<void> => {
  await db.mutations.add(mutation);
};

const pushMutations = async (): Promise<void> => {
  if (!isSupabaseEnabled || !supabase) {
    return;
  }

  const queue = await db.mutations.orderBy('id').toArray();
  for (const mutation of queue) {
    const table = mutation.table;
    const payload = toRemote(table, mutation.payload);

    const { error } =
      mutation.op === 'upsert'
        ? await supabase.from(table).upsert(payload)
        : await supabase.from(table).delete().eq('id', String((payload as { id: string }).id));

    if (error) {
      break;
    }

    if (mutation.id !== undefined) {
      await db.mutations.delete(mutation.id);
    }
  }
};

const pullSnapshot = async (): Promise<void> => {
  if (!isSupabaseEnabled || !supabase) {
    return;
  }

  for (const table of tableNames) {
    const { data, error } = await supabase.from(table).select('*');
    if (error || !data) {
      continue;
    }

    const localRows = data.map((row) => toLocal(table, row as Record<string, unknown>));

    if (table === 'categories') {
      await db.categories.bulkPut(localRows as PriorityCategory[]);
    }
    if (table === 'items') {
      await db.items.bulkPut(localRows as PlanItem[]);
    }
    if (table === 'actions') {
      await db.actions.bulkPut(localRows as PlanAction[]);
    }
    if (table === 'events') {
      await db.events.bulkPut(localRows as CalendarEvent[]);
    }
    if (table === 'profiles') {
      await db.profiles.bulkPut(localRows as UserProfile[]);
    }
  }
};

export const syncAll = async (): Promise<void> => {
  await pushMutations();
  await pullSnapshot();
};
