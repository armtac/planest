import { useCallback, useEffect, useMemo, useState } from 'react';
import { endOfWeek, isWithinInterval, startOfWeek } from 'date-fns';
import { db, createId, nowIso } from '../db';
import { isSupabaseEnabled } from '../supabase';
import { enqueueMutation, syncAll } from '../sync';
import type { CalendarEvent, PlanAction, PlanItem, PriorityCategory, UserProfile, WeeklySummary } from '../types';

type AddEventInput = {
  title: string;
  categoryId: string | null;
  startsAt: string;
  endsAt: string;
  recurrenceRule: string | null;
  exceptionDates: string[];
  reminders: string[];
  mentionUserIds: string[];
  color: string;
  colorName: string | null;
  attachmentName: string | null;
  attachmentDataUrl: string | null;
};

export const usePlanestData = () => {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [categories, setCategories] = useState<PriorityCategory[]>([]);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [actions, setActions] = useState<PlanAction[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextProfiles, nextCategories, nextItems, nextActions, nextEvents] = await Promise.all([
      db.profiles.toArray(),
      db.categories.toArray(),
      db.items.toArray(),
      db.actions.toArray(),
      db.events.toArray(),
    ]);

    setProfiles(nextProfiles);
    setCategories(nextCategories);
    setItems(nextItems);
    setActions(nextActions);
    setEvents(nextEvents);
  }, []);

  const safeSync = useCallback(async () => {
    if (!isSupabaseEnabled || !navigator.onLine) {
      return;
    }

    setIsSyncing(true);
    try {
      await syncAll();
      setLastSyncAt(new Date().toISOString());
      await refresh();
    } finally {
      setIsSyncing(false);
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleOnline = () => {
      void safeSync();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [safeSync]);

  const addCategory = useCallback(
    async (title: string, owner: string, ownerUserId: string | null, color: string, colorName: string | null) => {
      const timestamp = nowIso();
      const category: PriorityCategory = {
        id: createId(),
        title,
        owner,
        ownerUserId,
        color,
        colorName,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.categories.put(category);
      await enqueueMutation({ table: 'categories', op: 'upsert', payload: category, createdAt: timestamp });
      await refresh();
      void safeSync();
    },
    [refresh, safeSync],
  );

  const addItem = useCallback(
    async (categoryId: string, title: string, note: string, mentionUserIds: string[]) => {
      const timestamp = nowIso();
      const item: PlanItem = {
        id: createId(),
        categoryId,
        title,
        note,
        mentionUserIds,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.items.put(item);
      await enqueueMutation({ table: 'items', op: 'upsert', payload: item, createdAt: timestamp });
      await refresh();
      void safeSync();
    },
    [refresh, safeSync],
  );

  const addAction = useCallback(
    async (itemId: string, title: string, dueDate: string | null, reminders: string[], mentionUserIds: string[]) => {
      const timestamp = nowIso();
      const action: PlanAction = {
        id: createId(),
        itemId,
        title,
        percentComplete: 0,
        dueDate,
        reminders,
        mentionUserIds,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.actions.put(action);
      await enqueueMutation({ table: 'actions', op: 'upsert', payload: action, createdAt: timestamp });
      await refresh();
      void safeSync();
    },
    [refresh, safeSync],
  );

  const updateActionProgress = useCallback(
    async (actionId: string, percentComplete: number) => {
      const existing = await db.actions.get(actionId);
      if (!existing) {
        return;
      }

      const updated: PlanAction = {
        ...existing,
        percentComplete: Math.max(0, Math.min(100, percentComplete)),
        updatedAt: nowIso(),
      };

      await db.actions.put(updated);
      await enqueueMutation({ table: 'actions', op: 'upsert', payload: updated, createdAt: nowIso() });
      await refresh();
      void safeSync();
    },
    [refresh, safeSync],
  );

  const addEvent = useCallback(
    async (input: AddEventInput) => {
      const timestamp = nowIso();
      const event: CalendarEvent = {
        id: createId(),
        title: input.title,
        categoryId: input.categoryId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        recurrenceRule: input.recurrenceRule,
        exceptionDates: input.exceptionDates,
        reminders: input.reminders,
        mentionUserIds: input.mentionUserIds,
        color: input.color,
        colorName: input.colorName,
        attachmentName: input.attachmentName,
        attachmentDataUrl: input.attachmentDataUrl,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.events.put(event);
      await enqueueMutation({ table: 'events', op: 'upsert', payload: event, createdAt: timestamp });
      await refresh();
      void safeSync();
    },
    [refresh, safeSync],
  );

  const itemProgressMap = useMemo(() => {
    const map = new Map<string, number>();

    for (const item of items) {
      const linkedActions = actions.filter((action) => action.itemId === item.id);
      if (linkedActions.length === 0) {
        map.set(item.id, 0);
        continue;
      }

      const total = linkedActions.reduce((sum, action) => sum + action.percentComplete, 0);
      map.set(item.id, Math.round(total / linkedActions.length));
    }

    return map;
  }, [actions, items]);

  const categoryProgressMap = useMemo(() => {
    const map = new Map<string, number>();

    for (const category of categories) {
      const linkedItems = items.filter((item) => item.categoryId === category.id);
      if (linkedItems.length === 0) {
        map.set(category.id, 0);
        continue;
      }

      const total = linkedItems.reduce((sum, item) => sum + (itemProgressMap.get(item.id) ?? 0), 0);
      map.set(category.id, Math.round(total / linkedItems.length));
    }

    return map;
  }, [categories, items, itemProgressMap]);

  const weeklySummary = useMemo<WeeklySummary>(() => {
    const now = new Date();
    const interval = {
      start: startOfWeek(now, { weekStartsOn: 1 }),
      end: endOfWeek(now, { weekStartsOn: 1 }),
    };

    const completedActions = actions.filter((action) => action.percentComplete >= 100).length;
    const incompleteActions = actions.length - completedActions;
    const dueThisWeek = actions.filter((action) => {
      if (!action.dueDate) {
        return false;
      }
      return isWithinInterval(new Date(action.dueDate), interval);
    }).length;
    const eventsThisWeek = events.filter((event) => isWithinInterval(new Date(event.startsAt), interval)).length;

    return { completedActions, incompleteActions, dueThisWeek, eventsThisWeek };
  }, [actions, events]);

  const incompleteWithDueDate = useMemo(
    () => actions.filter((action) => action.percentComplete < 100 && Boolean(action.dueDate)),
    [actions],
  );

  const saveEvent = useCallback(
    async (event: CalendarEvent) => {
      const updated = { ...event, updatedAt: nowIso() };
      await db.events.put(updated);
      await enqueueMutation({ table: 'events', op: 'upsert', payload: updated, createdAt: nowIso() });
      await refresh();
      void safeSync();
    },
    [refresh, safeSync],
  );

  const deleteEventSeries = useCallback(
    async (eventId: string) => {
      const existing = await db.events.get(eventId);
      if (!existing) {
        return;
      }

      await db.events.delete(eventId);
      await enqueueMutation({ table: 'events', op: 'delete', payload: { id: eventId }, createdAt: nowIso() });
      await refresh();
      void safeSync();
    },
    [refresh, safeSync],
  );

  const deleteEventOccurrence = useCallback(
    async (eventId: string, occurrenceDateIso: string) => {
      const existing = await db.events.get(eventId);
      if (!existing) {
        return;
      }

      if (!existing.recurrenceRule) {
        await deleteEventSeries(eventId);
        return;
      }

      const dayIso = occurrenceDateIso.slice(0, 10);
      const nextExceptionDates = Array.from(new Set([...(existing.exceptionDates ?? []), dayIso]));
      await saveEvent({ ...existing, exceptionDates: nextExceptionDates });
    },
    [deleteEventSeries, saveEvent],
  );

  return {
    profiles,
    categories,
    items,
    actions,
    events,
    itemProgressMap,
    categoryProgressMap,
    weeklySummary,
    incompleteWithDueDate,
    isSyncing,
    lastSyncAt,
    addCategory,
    addItem,
    addAction,
    updateActionProgress,
    addEvent,
    deleteEventSeries,
    deleteEventOccurrence,
    syncNow: safeSync,
    refresh,
    usesSupabase: isSupabaseEnabled,
  };
};
