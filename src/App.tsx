import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  addDays,
  addMinutes,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns';
import { RRule, rrulestr } from 'rrule';
import { usePlanestData } from './hooks/usePlanestData';
import { isSupabaseEnabled, supabase } from './supabase';
import type { UserProfile } from './types';
import './App.css';

type AppPage = 'home' | 'calendar' | 'priorities';
type CalendarView = 'month' | 'week' | 'day';

type AgendaEvent = {
  id: string;
  baseEventId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  occurrenceDate: string;
  color: string;
  colorName: string | null;
  priorityId: string | null;
  mentionUserIds: string[];
  attachmentName: string | null;
  attachmentDataUrl: string | null;
  source: 'planest' | 'holiday';
  isRecurring: boolean;
};

type NagerHoliday = {
  date: string;
  localName: string;
  name: string;
};

const weekdayOptions = [
  { label: 'Lun', value: 'MO' },
  { label: 'Mar', value: 'TU' },
  { label: 'Mer', value: 'WE' },
  { label: 'Gio', value: 'TH' },
  { label: 'Ven', value: 'FR' },
  { label: 'Sab', value: 'SA' },
  { label: 'Dom', value: 'SU' },
] as const;

const weekdayLabels = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const jsDayToRRuleDay = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const holidayColor = '#b45309';

const presetColors = [
  { value: '#ef4444', name: 'Rosso' },
  { value: '#f87171', name: 'Rosso Chiaro' },
  { value: '#b91c1c', name: 'Rosso Scuro' },
  { value: '#f97316', name: 'Arancione' },
  { value: '#fb923c', name: 'Arancione Chiaro' },
  { value: '#c2410c', name: 'Arancione Scuro' },
  { value: '#eab308', name: 'Giallo' },
  { value: '#facc15', name: 'Giallo Chiaro' },
  { value: '#a16207', name: 'Giallo Scuro' },
  { value: '#22c55e', name: 'Verde' },
  { value: '#4ade80', name: 'Verde Chiaro' },
  { value: '#15803d', name: 'Verde Scuro' },
  { value: '#0f766e', name: 'Petrolio' },
  { value: '#14b8a6', name: 'Petrolio Chiaro' },
  { value: '#115e59', name: 'Petrolio Scuro' },
  { value: '#3b82f6', name: 'Blu' },
  { value: '#60a5fa', name: 'Blu Chiaro' },
  { value: '#1d4ed8', name: 'Blu Scuro' },
  { value: '#a855f7', name: 'Viola' },
  { value: '#c084fc', name: 'Viola Chiaro' },
  { value: '#7e22ce', name: 'Viola Scuro' },
  { value: '#ec4899', name: 'Rosa' },
  { value: '#f472b6', name: 'Rosa Chiaro' },
  { value: '#be185d', name: 'Rosa Scuro' },
  { value: '#64748b', name: 'Grigio' },
  { value: '#94a3b8', name: 'Grigio Chiaro' },
  { value: '#334155', name: 'Grigio Scuro' },
] as const;

const colorCategoryStorageKey = 'planest_color_categories';

const buildDefaultColorCategories = (): Record<string, string> =>
  presetColors.reduce<Record<string, string>>((acc, color) => {
    acc[color.value] = '';
    return acc;
  }, {});

const loadColorCategories = (): Record<string, string> => {
  const defaults = buildDefaultColorCategories();
  if (typeof window === 'undefined') {
    return defaults;
  }

  const raw = localStorage.getItem(colorCategoryStorageKey);
  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
};

const getColorOptionLabel = (value: string, colorCategories: Record<string, string>): string => {
  const color = presetColors.find((entry) => entry.value === value);
  const colorName = color?.name ?? 'Colore';
  const category = colorCategories[value];
  return category ? `${colorName} · ${category}` : colorName;
};

const parseRecurrenceRule = (
  recurrenceRule: string | null,
): { type: string; weekdays: string[]; untilDate: string } => {
  if (!recurrenceRule) {
    return { type: 'none', weekdays: [], untilDate: '' };
  }
  const raw = recurrenceRule.replace(/^RRULE:/, '');
  const freq = /(?:^|;)FREQ=([^;]+)/.exec(raw)?.[1]?.toLowerCase() ?? 'none';
  const byday = /(?:^|;)BYDAY=([^;]+)/.exec(raw)?.[1] ?? '';
  const until = /(?:^|;)UNTIL=([^;]+)/.exec(raw)?.[1] ?? '';
  const untilDate = until.length >= 8 ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}` : '';
  return {
    type: ['daily', 'weekly', 'monthly'].includes(freq) ? freq : 'none',
    weekdays: byday ? byday.split(',').filter(Boolean) : [],
    untilDate,
  };
};

type RecurrenceConfig = {
  type: string;
  startsAtLocal: string;
  untilDate: string;
  weekdays: string[];
};

const toIsoFromDateTimeLocal = (value: string): string | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
};

const toDateTimeLocalValue = (date: Date): string => format(date, "yyyy-MM-dd'T'HH:mm");

const toRRuleUtcDateTime = (value: string): string =>
  new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

const recurrenceToRRule = ({ type, startsAtLocal, untilDate, weekdays }: RecurrenceConfig): string | null => {
  if (type === 'none') {
    return null;
  }

  let rule = `RRULE:FREQ=${type.toUpperCase()};INTERVAL=1`;

  if (type === 'weekly') {
    const fallbackDay = jsDayToRRuleDay[new Date(startsAtLocal).getDay()];
    const selectedDays = weekdays.length > 0 ? weekdays : [fallbackDay];
    rule = `${rule};BYDAY=${selectedDays.join(',')}`;
  }

  if (untilDate) {
    rule = `${rule};UNTIL=${toRRuleUtcDateTime(`${untilDate}T23:59:59`)}`;
  }

  return rule;
};

const getViewRange = (view: CalendarView, anchorDate: Date): { start: Date; end: Date } => {
  if (view === 'day') {
    return { start: startOfDay(anchorDate), end: endOfDay(anchorDate) };
  }
  if (view === 'week') {
    return {
      start: startOfWeek(anchorDate, { weekStartsOn: 1 }),
      end: endOfWeek(anchorDate, { weekStartsOn: 1 }),
    };
  }
  return {
    start: startOfWeek(startOfMonth(anchorDate), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(anchorDate), { weekStartsOn: 1 }),
  };
};

const moveAnchorDate = (view: CalendarView, anchorDate: Date, direction: 'prev' | 'next'): Date => {
  if (view === 'day') {
    return direction === 'next' ? addDays(anchorDate, 1) : subDays(anchorDate, 1);
  }
  if (view === 'week') {
    return direction === 'next' ? addWeeks(anchorDate, 1) : subWeeks(anchorDate, 1);
  }
  return direction === 'next' ? addMonths(anchorDate, 1) : subMonths(anchorDate, 1);
};

const getViewTitle = (view: CalendarView, anchorDate: Date): string => {
  if (view === 'day') {
    return format(anchorDate, 'EEEE dd MMMM yyyy');
  }
  if (view === 'week') {
    const start = startOfWeek(anchorDate, { weekStartsOn: 1 });
    const end = endOfWeek(anchorDate, { weekStartsOn: 1 });
    return `${format(start, 'dd MMM')} - ${format(end, 'dd MMM yyyy')}`;
  }
  return format(anchorDate, 'MMMM yyyy');
};

const fileToDataUrl = async (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Unable to read file'));
    reader.readAsDataURL(file);
  });

const formatReminder = (iso: string): string => format(new Date(iso), 'dd/MM/yyyy HH:mm');

const getDayIso = (date: Date): string => format(date, 'yyyy-MM-dd');

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseMentionUserIds = (text: string, users: UserProfile[]): string[] => {
  const found = users
    .filter((user) => new RegExp(`(^|\\s)@${escapeRegExp(user.displayName)}\\b`, 'i').test(text))
    .map((user) => user.id);
  return Array.from(new Set(found));
};

const appendMention = (text: string, user: UserProfile): string => {
  const suffix = text.endsWith(' ') || text.length === 0 ? '' : ' ';
  return `${text}${suffix}@${user.displayName} `;
};

const MentionHelper = ({
  users,
  onMention,
}: {
  users: UserProfile[];
  onMention: (user: UserProfile) => void;
}) => (
  <div className="mention-helper">
    <small>Tagga utente:</small>
    <div className="mention-list">
      {users.map((user) => (
        <button key={user.id} type="button" className="mention-btn" onClick={() => onMention(user)}>
          @{user.displayName}
        </button>
      ))}
    </div>
  </div>
);

const SwipeActionRow = ({
  onEdit,
  onDelete,
  leftAction,
  children,
}: {
  onEdit?: () => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  leftAction?: {
    label: 'Fatto' | 'Riapri';
    onClick: () => Promise<void> | void;
  };
  children: ReactNode;
}) => {
  const actionWidth = 88;
  const revealRight = onEdit ? actionWidth * 2 : actionWidth;
  const revealLeft = leftAction ? actionWidth : 0;
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const startXRef = useRef<number | null>(null);
  const baseOffsetRef = useRef(0);
  const draggingRef = useRef(false);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  const clampOffset = (value: number) => Math.max(-revealRight, Math.min(revealLeft, value));

  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return Boolean(target.closest('input, textarea, select, button, a'));
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) {
      return;
    }
    startXRef.current = event.touches[0]?.clientX ?? null;
    baseOffsetRef.current = offsetRef.current;
    draggingRef.current = true;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!draggingRef.current || startXRef.current === null) {
      return;
    }
    const currentX = event.touches[0]?.clientX;
    if (currentX === undefined) {
      return;
    }
    const delta = currentX - startXRef.current;
    const next = clampOffset(baseOffsetRef.current + delta);
    setOffset(next);
  };

  const handleTouchEnd = () => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    startXRef.current = null;
    if (offsetRef.current <= -revealRight * 0.45) {
      setOffset(-revealRight);
      return;
    }
    if (leftAction && offsetRef.current >= revealLeft * 0.45) {
      setOffset(revealLeft);
      return;
    }
    setOffset(0);
  };

  const handleDeleteClick = async () => {
    await onDelete();
    setOffset(0);
  };

  const handleLeftActionClick = async () => {
    if (!leftAction) {
      return;
    }
    await leftAction.onClick();
    setOffset(0);
  };

  const handleEditClick = async () => {
    if (!onEdit) {
      return;
    }
    await onEdit();
    setOffset(0);
  };

  return (
    <div className="swipe-delete">
      {leftAction && (
        <button
          type="button"
          className={leftAction.label === 'Riapri' ? 'swipe-reopen-btn' : 'swipe-done-btn'}
          onClick={() => void handleLeftActionClick()}
        >
          {leftAction.label}
        </button>
      )}
      {onEdit && (
        <button type="button" className="swipe-edit-btn" onClick={() => void handleEditClick()}>
          Modifica
        </button>
      )}
      <button type="button" className="swipe-delete-btn" onClick={() => void handleDeleteClick()}>
        Elimina
      </button>
      <div
        className="swipe-delete-track"
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (offsetRef.current !== 0) {
            setOffset(0);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
};

const ReminderEditor = ({
  label,
  inputValue,
  reminders,
  onInputChange,
  onAdd,
  onRemove,
}: {
  label: string;
  inputValue: string;
  reminders: string[];
  onInputChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) => (
  <div className="reminder-editor">
    <label>{label}</label>
    <div className="reminder-row">
      <input type="datetime-local" value={inputValue} onChange={(event) => onInputChange(event.target.value)} />
      <button type="button" onClick={onAdd}>
        Aggiungi
      </button>
    </div>
    <div className="reminder-list">
      {reminders.length === 0 && <small>Nessun reminder.</small>}
      {reminders.map((reminder, idx) => (
        <span key={`${reminder}-${idx}`} className="reminder-chip">
          {formatReminder(reminder)}
          <button type="button" onClick={() => onRemove(idx)}>
            x
          </button>
        </span>
      ))}
    </div>
  </div>
);

function App() {
  const {
    profiles,
    categories,
    actions,
    events,
    categoryProgressMap,
    weeklySummary,
    incompleteWithDueDate,
    isSyncing,
    lastSyncAt,
    addCategory,
    addAction,
    updateActionProgress,
    updatePriorityMeta,
    updateActionTitle,
    deletePriority,
    deleteAction,
    addEvent,
    updateEvent,
    deleteEventSeries,
    deleteEventOccurrence,
    trimEventSeries,
    syncNow,
    usesSupabase,
  } = usePlanestData();

  const handleDeletePriority = async (categoryId: string) => {
    await deletePriority(categoryId);
  };

  const handleDeleteAction = async (actionId: string) => {
    await deleteAction(actionId);
  };

  const handleMarkActionDone = async (actionId: string) => {
    await updateActionProgress(actionId, 100);
  };

  const handleReopenAction = async (actionId: string) => {
    await updateActionProgress(actionId, 0);
  };

  const handleMarkPriorityDone = async (categoryId: string) => {
    const pendingActions = actions.filter((action) => action.categoryId === categoryId && action.percentComplete < 100);
    for (const action of pendingActions) {
      await updateActionProgress(action.id, 100);
    }
  };

  const handleReopenPriority = async (categoryId: string) => {
    const doneActions = actions.filter((action) => action.categoryId === categoryId && action.percentComplete >= 100);
    for (const action of doneActions) {
      await updateActionProgress(action.id, 0);
    }
  };

  const handleStartEditPriority = (categoryId: string, currentTitle: string, currentColor: string) => {
    setEditingPriorityId(categoryId);
    setEditingPriorityTitle(currentTitle);
    setEditingPriorityColor(currentColor);
  };

  const handleSaveEditPriority = async () => {
    if (!editingPriorityId || !editingPriorityTitle.trim()) {
      return;
    }
    await updatePriorityMeta(
      editingPriorityId,
      editingPriorityTitle.trim(),
      editingPriorityColor,
      colorCategories[editingPriorityColor] || null,
    );
    setEditingPriorityId(null);
    setEditingPriorityTitle('');
  };

  const handleCancelEditPriority = () => {
    setEditingPriorityId(null);
    setEditingPriorityTitle('');
  };

  const handleEditAction = async (actionId: string, currentTitle: string) => {
    const next = window.prompt('Modifica titolo azione', currentTitle);
    if (!next || !next.trim()) {
      return;
    }
    await updateActionTitle(actionId, next.trim());
  };

  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [page, setPage] = useState<AppPage>('home');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterUserId, setFilterUserId] = useState('all');
  const [priorityActionStatusFilter, setPriorityActionStatusFilter] = useState<'all' | 'open' | 'done'>('all');
  const [expandedPriorityId, setExpandedPriorityId] = useState<string | null>(null);

  const [priorityTitle, setPriorityTitle] = useState('');
  const [priorityOwnerUserId, setPriorityOwnerUserId] = useState('');
  const [priorityColor, setPriorityColor] = useState<string>(presetColors[0].value);
  const [colorCategories, setColorCategories] = useState<Record<string, string>>(() => loadColorCategories());
  const [editingPriorityId, setEditingPriorityId] = useState<string | null>(null);
  const [editingPriorityTitle, setEditingPriorityTitle] = useState('');
  const [editingPriorityColor, setEditingPriorityColor] = useState<string>(presetColors[0].value);

  const [actionPriorityId, setActionPriorityId] = useState('');
  const [actionTitle, setActionTitle] = useState('');
  const [actionDueDate, setActionDueDate] = useState('');
  const [actionReminderInput, setActionReminderInput] = useState('');
  const [actionReminderList, setActionReminderList] = useState<string[]>([]);

  const [eventTitle, setEventTitle] = useState('');
  const [eventPriorityId, setEventPriorityId] = useState('');
  const [eventStartsAt, setEventStartsAt] = useState('');
  const [eventEndsAt, setEventEndsAt] = useState('');
  const [eventRecurrence, setEventRecurrence] = useState('none');
  const [eventRecurrenceUntil, setEventRecurrenceUntil] = useState('');
  const [eventRecurrenceWeekdays, setEventRecurrenceWeekdays] = useState<string[]>([]);
  const [eventReminderPreset, setEventReminderPreset] = useState<'30m' | '15m' | '5m' | '1d' | 'custom'>('30m');
  const [eventReminderCustomAt, setEventReminderCustomAt] = useState('');
  const [eventReminderList, setEventReminderList] = useState<string[]>([]);
  const [eventColor, setEventColor] = useState<string>(presetColors[0].value);
  const [eventFile, setEventFile] = useState<File | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventFeedback, setEventFeedback] = useState<string | null>(null);

  const [calendarView, setCalendarView] = useState<CalendarView>('month');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(new Date());
  const [calendarKeyword, setCalendarKeyword] = useState('');
  const [showItalianHolidays, setShowItalianHolidays] = useState(true);
  const [holidayEventsByYear, setHolidayEventsByYear] = useState<Record<number, AgendaEvent[]>>({});
  const loadingHolidayYearsRef = useRef<Set<number>>(new Set());

  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
  );
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [showProfileEmail, setShowProfileEmail] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedDayCardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled || !supabase) {
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        void syncNow();
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        void syncNow();
      }
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, [syncNow]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!userMenuRef.current) {
        return;
      }
      if (!userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
        setShowProfileEmail(false);
      }
    };
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    localStorage.setItem(colorCategoryStorageKey, JSON.stringify(colorCategories));
  }, [colorCategories]);

  const effectiveUsers = useMemo(() => {
    if (profiles.length > 0) {
      return profiles;
    }

    const fallbackNames = Array.from(new Set(categories.map((category) => category.owner).filter(Boolean)));
    return fallbackNames.map((name) => ({
      id: name,
      email: null,
      displayName: name,
      createdAt: '',
      updatedAt: '',
    }));
  }, [categories, profiles]);

  const currentUserDisplayName = useMemo(() => {
    const current = effectiveUsers.find((user) => user.id === session?.user.id);
    if (current?.displayName) {
      return current.displayName;
    }
    if (session?.user.email) {
      return session.user.email.split('@')[0];
    }
    return 'Utente';
  }, [effectiveUsers, session?.user.email, session?.user.id]);

  useEffect(() => {
    if (!priorityOwnerUserId && effectiveUsers.length > 0) {
      const currentUser = effectiveUsers.find((user) => user.id === session?.user.id) ?? effectiveUsers[0];
      setPriorityOwnerUserId(currentUser.id);
    }
  }, [effectiveUsers, priorityOwnerUserId, session?.user.id]);

  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);

  const isCategoryRelevantToUser = useCallback(
    (categoryId: string): boolean => {
      if (filterUserId === 'all') {
        return true;
      }
      const category = categoryMap.get(categoryId);
      return category?.ownerUserId === filterUserId;
    },
    [categoryMap, filterUserId],
  );

  const filteredActions = useMemo(() => {
    return actions.filter((action) => {
      if (filterPriority !== 'all' && action.categoryId !== filterPriority) {
        return false;
      }
      if (filterUserId === 'all') {
        return true;
      }
      if (action.mentionUserIds.includes(filterUserId)) {
        return true;
      }
      return isCategoryRelevantToUser(action.categoryId);
    });
  }, [actions, filterPriority, filterUserId, isCategoryRelevantToUser]);

  const priorityPageActions = useMemo(() => {
    if (priorityActionStatusFilter === 'done') {
      return filteredActions.filter((action) => action.percentComplete >= 100);
    }
    if (priorityActionStatusFilter === 'open') {
      return filteredActions.filter((action) => action.percentComplete < 100);
    }
    return filteredActions;
  }, [filteredActions, priorityActionStatusFilter]);

  const visiblePriorities = useMemo(() => {
    return categories.filter((priority) => {
      if (filterPriority !== 'all' && priority.id !== filterPriority) {
        return false;
      }
      if (filterUserId !== 'all' && priority.ownerUserId !== filterUserId) {
        const hasRelatedAction = actions.some(
          (action) => action.categoryId === priority.id && action.mentionUserIds.includes(filterUserId),
        );
        return hasRelatedAction;
      }
      return true;
    });
  }, [actions, categories, filterPriority, filterUserId]);

  const monthGridDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(calendarDate), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(calendarDate), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [calendarDate]);

  const weekDays = useMemo(() => eachDayOfInterval(getViewRange('week', calendarDate)), [calendarDate]);

  const yearsInRange = useMemo(() => {
    const range = getViewRange(calendarView, calendarDate);
    const years: number[] = [];
    for (let year = range.start.getFullYear(); year <= range.end.getFullYear(); year += 1) {
      years.push(year);
    }
    return years;
  }, [calendarDate, calendarView]);

  useEffect(() => {
    if (!showItalianHolidays) {
      return;
    }

    const yearsToLoad = yearsInRange.filter((year) => !holidayEventsByYear[year] && !loadingHolidayYearsRef.current.has(year));
    if (yearsToLoad.length === 0) {
      return;
    }

    for (const year of yearsToLoad) {
      loadingHolidayYearsRef.current.add(year);
      void fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/IT`)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Failed holidays ${year}`);
          }
          return (await response.json()) as NagerHoliday[];
        })
        .then((holidays) => {
          const mapped: AgendaEvent[] = holidays.map((holiday) => {
            const start = new Date(`${holiday.date}T00:00:00`);
            return {
              id: `holiday-${holiday.date}`,
              baseEventId: `holiday-${holiday.date}`,
              title: holiday.localName || holiday.name,
              startsAt: start,
              endsAt: new Date(`${holiday.date}T23:59:59`),
              occurrenceDate: holiday.date,
              color: holidayColor,
              colorName: 'Festivita',
              priorityId: null,
              mentionUserIds: [],
              attachmentName: null,
              attachmentDataUrl: null,
              source: 'holiday' as const,
              isRecurring: false,
            };
          });
          setHolidayEventsByYear((current) => ({ ...current, [year]: mapped }));
        })
        .catch(() => {
          setHolidayEventsByYear((current) => ({ ...current, [year]: [] }));
        })
        .finally(() => {
          loadingHolidayYearsRef.current.delete(year);
        });
    }
  }, [holidayEventsByYear, showItalianHolidays, yearsInRange]);

  const visibleCalendarEvents = useMemo<AgendaEvent[]>(() => {
    const range = getViewRange(calendarView, calendarDate);

    const planEvents = events.flatMap((event) => {
      if (filterPriority !== 'all' && event.categoryId !== filterPriority) {
        return [];
      }

      if (filterUserId !== 'all') {
        const categoryRelevant = event.categoryId ? isCategoryRelevantToUser(event.categoryId) : false;
        const mentionRelevant = event.mentionUserIds.includes(filterUserId);
        if (!categoryRelevant && !mentionRelevant) {
          return [];
        }
      }

      const sourceStart = new Date(event.startsAt);
      const sourceEnd = new Date(event.endsAt);
      const durationMs = Math.max(0, sourceEnd.getTime() - sourceStart.getTime());

      if (!event.recurrenceRule) {
        if (sourceStart >= range.start && sourceStart <= range.end) {
          const occurrenceDate = getDayIso(sourceStart);
          if ((event.exceptionDates ?? []).includes(occurrenceDate)) {
            return [];
          }
          return [
            {
              id: event.id,
              baseEventId: event.id,
              title: event.title,
              startsAt: sourceStart,
              endsAt: sourceEnd,
              occurrenceDate,
              color: event.color,
              colorName: event.colorName,
              priorityId: event.categoryId,
              mentionUserIds: event.mentionUserIds,
              attachmentName: event.attachmentName,
              attachmentDataUrl: event.attachmentDataUrl,
              source: 'planest' as const,
              isRecurring: false,
            },
          ];
        }
        return [];
      }

      const rule = rrulestr(event.recurrenceRule.replace('RRULE:', ''), { dtstart: sourceStart }) as RRule;
      const exceptionSet = new Set(event.exceptionDates ?? []);

      return rule
        .between(range.start, range.end, true)
        .filter((occurrence) => !exceptionSet.has(getDayIso(occurrence)))
        .map((occurrence, idx) => ({
          id: `${event.id}-${idx}-${occurrence.toISOString()}`,
          baseEventId: event.id,
          title: event.title,
          startsAt: occurrence,
          endsAt: new Date(occurrence.getTime() + durationMs),
          occurrenceDate: getDayIso(occurrence),
          color: event.color,
          colorName: event.colorName,
          priorityId: event.categoryId,
          mentionUserIds: event.mentionUserIds,
          attachmentName: event.attachmentName,
          attachmentDataUrl: event.attachmentDataUrl,
          source: 'planest' as const,
          isRecurring: true,
        }));
    });

    const holidayEvents = showItalianHolidays
      ? Object.values(holidayEventsByYear)
          .flat()
          .filter((event) => event.startsAt >= range.start && event.startsAt <= range.end)
      : [];

    return [...planEvents, ...holidayEvents]
      .filter((event) => event.title.toLowerCase().includes(calendarKeyword.toLowerCase().trim()))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }, [
    calendarDate,
    calendarKeyword,
    calendarView,
    events,
    filterPriority,
    filterUserId,
    holidayEventsByYear,
    isCategoryRelevantToUser,
    showItalianHolidays,
  ]);

  const selectedDayEvents = useMemo(
    () => visibleCalendarEvents.filter((event) => isSameDay(event.startsAt, selectedCalendarDate)),
    [selectedCalendarDate, visibleCalendarEvents],
  );

  const filteredIncompleteActions = useMemo(
    () =>
      incompleteWithDueDate.filter((action) => {
        if (filterUserId === 'all') {
          return true;
        }
        if (action.mentionUserIds.includes(filterUserId)) {
          return true;
        }
        return isCategoryRelevantToUser(action.categoryId);
      }),
    [filterUserId, incompleteWithDueDate, isCategoryRelevantToUser],
  );

  const overdueActions = useMemo(
    () =>
      filteredIncompleteActions
        .filter((action) => action.dueDate && isBefore(new Date(action.dueDate), new Date()))
        .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()),
    [filteredIncompleteActions],
  );

  const upcomingActions = useMemo(
    () =>
      filteredIncompleteActions
        .filter((action) => action.dueDate && !isBefore(new Date(action.dueDate), new Date()))
        .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()),
    [filteredIncompleteActions],
  );

  useEffect(() => {
    if (notificationPermission !== 'granted' || typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }

    const sentKey = 'planest_sent_reminders';

    const checkReminders = () => {
      const sentRaw = localStorage.getItem(sentKey);
      const sent = new Set<string>(sentRaw ? JSON.parse(sentRaw) : []);
      const now = new Date();

      for (const action of filteredActions) {
        if (action.percentComplete >= 100) {
          continue;
        }
        for (const reminder of action.reminders) {
          const reminderDate = new Date(reminder);
          const token = `action:${action.id}:${reminderDate.toISOString()}`;
          if (reminderDate <= now && !sent.has(token)) {
            new Notification('Planest Reminder', { body: `Azione incompleta: ${action.title}` });
            sent.add(token);
          }
        }
      }

      for (const event of events) {
        for (const reminder of event.reminders) {
          const reminderDate = new Date(reminder);
          const token = `event:${event.id}:${reminderDate.toISOString()}`;
          if (reminderDate <= now && !sent.has(token)) {
            new Notification('Planest Reminder', { body: `Evento: ${event.title}` });
            sent.add(token);
          }
        }
      }

      localStorage.setItem(sentKey, JSON.stringify(Array.from(sent)));
    };

    checkReminders();
    const timerId = window.setInterval(checkReminders, 30_000);
    return () => window.clearInterval(timerId);
  }, [events, filteredActions, notificationPermission]);

  const requestNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  const handleAuthSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
          options: {
            data: { display_name: authDisplayName || authEmail.split('@')[0] },
          },
        });
        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
        if (error) {
          throw error;
        }
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Errore autenticazione');
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    if (!supabase) {
      return;
    }
    await supabase.auth.signOut();
  };

  const selectCalendarDay = (date: Date) => {
    const selected = new Date(date);
    selected.setHours(0, 0, 0, 0);
    const start = new Date(selected);
    start.setHours(9, 0, 0, 0);
    setSelectedCalendarDate(selected);
    setEventStartsAt(toDateTimeLocalValue(start));
    setEventEndsAt(toDateTimeLocalValue(addMinutes(start, 30)));
    window.setTimeout(() => {
      selectedDayCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 30);
  };

  const handleEventStartChange = (value: string) => {
    setEventStartsAt(value);
    const start = toIsoFromDateTimeLocal(value);
    if (!start) {
      return;
    }
    setEventEndsAt(toDateTimeLocalValue(addMinutes(new Date(start), 30)));
  };

  const handleCreatePriority = async (event: FormEvent) => {
    event.preventDefault();
    const ownerUser = effectiveUsers.find((user) => user.id === priorityOwnerUserId);
    if (!priorityTitle.trim() || !ownerUser) {
      return;
    }

    await addCategory(
      priorityTitle.trim(),
      ownerUser.displayName,
      ownerUser.id,
      priorityColor,
      colorCategories[priorityColor] || null,
    );

    setPriorityTitle('');
  };

  const addActionReminder = () => {
    const iso = toIsoFromDateTimeLocal(actionReminderInput);
    if (!iso) {
      return;
    }
    setActionReminderList((current) => [...current, iso]);
    setActionReminderInput('');
  };

  const removeActionReminder = (idx: number) => {
    setActionReminderList((current) => current.filter((_, currentIdx) => currentIdx !== idx));
  };

  const handleCreateAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!actionPriorityId || !actionTitle.trim()) {
      return;
    }

    const mentionUserIds = parseMentionUserIds(actionTitle, effectiveUsers);
    await addAction(actionPriorityId, actionTitle.trim(), toIsoFromDateTimeLocal(actionDueDate), actionReminderList, mentionUserIds);

    setActionTitle('');
    setActionDueDate('');
    setActionReminderInput('');
    setActionReminderList([]);
  };

  const addEventReminder = () => {
    let iso: string | null = null;
    const eventStartDate = toIsoFromDateTimeLocal(eventStartsAt);
    const start = eventStartDate ? new Date(eventStartDate) : null;
    if (eventReminderPreset === 'custom') {
      iso = toIsoFromDateTimeLocal(eventReminderCustomAt);
    } else if (start) {
      if (eventReminderPreset === '30m') {
        iso = addMinutes(start, -30).toISOString();
      }
      if (eventReminderPreset === '15m') {
        iso = addMinutes(start, -15).toISOString();
      }
      if (eventReminderPreset === '5m') {
        iso = addMinutes(start, -5).toISOString();
      }
      if (eventReminderPreset === '1d') {
        iso = addDays(start, -1).toISOString();
      }
    }

    if (!iso) {
      return;
    }
    setEventReminderList((current) => Array.from(new Set([...current, iso])));
    if (eventReminderPreset === 'custom') {
      setEventReminderCustomAt('');
    }
  };

  const removeEventReminder = (idx: number) => {
    setEventReminderList((current) => current.filter((_, currentIdx) => currentIdx !== idx));
  };

  const toggleWeekday = (weekday: string) => {
    setEventRecurrenceWeekdays((current) =>
      current.includes(weekday) ? current.filter((entry) => entry !== weekday) : [...current, weekday],
    );
  };

  const handleCreateEvent = async (event: FormEvent) => {
    event.preventDefault();
    if (!eventTitle.trim() || !eventStartsAt || !eventEndsAt) {
      return;
    }

    const startsAtIso = toIsoFromDateTimeLocal(eventStartsAt);
    const endsAtIso = toIsoFromDateTimeLocal(eventEndsAt);
    if (!startsAtIso || !endsAtIso) {
      return;
    }

    const mentionUserIds = parseMentionUserIds(eventTitle, effectiveUsers);
    const currentEditing = editingEventId ? events.find((entry) => entry.id === editingEventId) ?? null : null;
    const attachmentDataUrl = eventFile ? await fileToDataUrl(eventFile) : currentEditing?.attachmentDataUrl ?? null;

    const input = {
      title: eventTitle.trim(),
      categoryId: eventPriorityId || null,
      startsAt: startsAtIso,
      endsAt: endsAtIso,
      recurrenceRule: recurrenceToRRule({
        type: eventRecurrence,
        startsAtLocal: eventStartsAt,
        untilDate: eventRecurrenceUntil,
        weekdays: eventRecurrenceWeekdays,
      }),
      exceptionDates: currentEditing?.exceptionDates ?? [],
      reminders: eventReminderList,
      mentionUserIds,
      color: eventColor,
      colorName: colorCategories[eventColor] || null,
      attachmentName: eventFile?.name ?? currentEditing?.attachmentName ?? null,
      attachmentDataUrl,
    };

    if (editingEventId) {
      await updateEvent(editingEventId, input);
      setEventFeedback('Evento aggiornato con successo.');
    } else {
      await addEvent(input);
      setEventFeedback('Evento aggiunto con successo.');
    }

    setEventTitle('');
    setEventPriorityId('');
    setEventRecurrence('none');
    setEventRecurrenceUntil('');
    setEventRecurrenceWeekdays([]);
    setEventReminderPreset('30m');
    setEventReminderCustomAt('');
    setEventReminderList([]);
    setEventFile(null);
    setEditingEventId(null);
  };

  const handleDeleteOccurrence = async (event: AgendaEvent) => {
    if (event.source !== 'planest') {
      return;
    }
    await deleteEventOccurrence(event.baseEventId, event.occurrenceDate);
  };

  const handleDeleteSeries = async (event: AgendaEvent) => {
    if (event.source !== 'planest') {
      return;
    }
    await deleteEventSeries(event.baseEventId);
  };

  const handleDeleteSeriesPartial = async (event: AgendaEvent) => {
    if (event.source !== 'planest' || !event.isRecurring) {
      return;
    }
    await trimEventSeries(event.baseEventId, event.occurrenceDate);
  };

  const handleStartEditEvent = (event: AgendaEvent) => {
    if (event.source !== 'planest') {
      return;
    }
    const sourceEvent = events.find((entry) => entry.id === event.baseEventId);
    const recurrence = parseRecurrenceRule(sourceEvent?.recurrenceRule ?? null);
    setEditingEventId(event.baseEventId);
    setEventTitle(event.title);
    setEventPriorityId(event.priorityId ?? '');
    setEventStartsAt(toDateTimeLocalValue(event.startsAt));
    setEventEndsAt(toDateTimeLocalValue(event.endsAt));
    setEventColor(event.color);
    setEventReminderList(sourceEvent?.reminders ?? []);
    setEventReminderPreset('30m');
    setEventReminderCustomAt('');
    setEventFile(null);
    setEventRecurrence(recurrence.type);
    setEventRecurrenceUntil(recurrence.untilDate);
    setEventRecurrenceWeekdays(recurrence.weekdays);
  };

  const handleCancelEditEvent = () => {
    setEditingEventId(null);
    setEventTitle('');
    setEventPriorityId('');
    setEventReminderList([]);
    setEventReminderPreset('30m');
    setEventReminderCustomAt('');
    setEventFile(null);
    setEventRecurrence('none');
    setEventRecurrenceUntil('');
    setEventRecurrenceWeekdays([]);
  };

  if (usesSupabase && !session) {
    return (
      <div className="app-shell">
        <section className="card auth-card">
          <img className="auth-intro" src="/intro.png" alt="Planest Intro" />
          <h1>Planest Login</h1>
          <p>Accedi per usare la pianificazione famiglia condivisa.</p>
          <form className="form-card" onSubmit={handleAuthSubmit}>
            <input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="Email" required />
            <input
              type="password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              placeholder="Password"
              required
            />
            {authMode === 'signup' && (
              <input
                value={authDisplayName}
                onChange={(event) => setAuthDisplayName(event.target.value)}
                placeholder="Nome visualizzato"
              />
            )}
            {authError && <small className="error-text">{authError}</small>}
            <button type="submit" disabled={authLoading}>
              {authLoading ? 'Attendere...' : authMode === 'signup' ? 'Crea account' : 'Accedi'}
            </button>
          </form>
          <button type="button" className="link-btn" onClick={() => setAuthMode((m) => (m === 'signin' ? 'signup' : 'signin'))}>
            {authMode === 'signin' ? 'Non hai account? Registrati' : 'Hai già account? Accedi'}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar card">
        <div className="brand-block">
          <h1 className="app-title">Planest</h1>
        </div>
        <nav className="top-nav" aria-label="Main">
          <button type="button" data-active={page === 'home'} onClick={() => setPage('home')}>
            Home
          </button>
          <button type="button" data-active={page === 'calendar'} onClick={() => setPage('calendar')}>
            Calendario
          </button>
          <button type="button" data-active={page === 'priorities'} onClick={() => setPage('priorities')}>
            Priorita
          </button>
          {usesSupabase && (
            <div className="user-menu-wrap" ref={userMenuRef}>
              <button
                type="button"
                className="user-badge"
                title={`Connesso come ${currentUserDisplayName}`}
                onClick={() => setIsUserMenuOpen((current) => !current)}
              >
                <span className="user-dot" />
                {currentUserDisplayName}
              </button>
              {isUserMenuOpen && (
                <div className="user-menu">
                  <button type="button" onClick={() => setShowProfileEmail((current) => !current)}>
                    Profilo
                  </button>
                  {showProfileEmail && <small>{session?.user.email ?? 'Email non disponibile'}</small>}
                  <button type="button" onClick={() => void signOut()}>
                    Logout
                  </button>
                </div>
              )}
            </div>
          )}
        </nav>
      </header>

      <section className="card toolbar">
        <div className="toolbar-left">
          {page !== 'priorities' && (
            <>
              <label className={page === 'calendar' ? 'toolbar-inline-field' : undefined}>
                Filtro priorita
                <select value={filterPriority} onChange={(event) => setFilterPriority(event.target.value)}>
                  <option value="all">Tutte</option>
                  {categories.map((priority) => (
                    <option key={priority.id} value={priority.id}>
                      {priority.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className={page === 'calendar' ? 'toolbar-inline-field' : undefined}>
                Filtro utente
                <select value={filterUserId} onChange={(event) => setFilterUserId(event.target.value)}>
                  <option value="all">Tutti</option>
                  {effectiveUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {page === 'calendar' && (
            <>
              <label className="toolbar-inline-field">
                Cerca
                <input
                  value={calendarKeyword}
                  onChange={(event) => setCalendarKeyword(event.target.value)}
                  placeholder="Parola chiave..."
                />
              </label>
              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={showItalianHolidays}
                  onChange={(event) => setShowItalianHolidays(event.target.checked)}
                />
                <span>Mostra festivita italiane</span>
              </label>
            </>
          )}
        </div>
      </section>

      {page === 'home' && (
        <section className="page-grid home-grid">
          <article className="card metric">
            <h3>Riepilogo settimanale</h3>
            <strong>{weeklySummary.completedActions} completate</strong>
            <p>
              {filteredActions.filter((action) => action.percentComplete < 100).length} incomplete -{' '}
              {filteredIncompleteActions.length} con scadenza - {visibleCalendarEvents.length} eventi visibili
            </p>
          </article>

          <article className="card list-card">
            <h3>Scadenze prossime</h3>
            {upcomingActions.slice(0, 6).map((action) => (
              <div key={action.id} className="list-row">
                <span>{action.title}</span>
                <small>{action.dueDate ? format(new Date(action.dueDate), 'dd/MM HH:mm') : '-'}</small>
              </div>
            ))}
            {upcomingActions.length === 0 && <p>Nessuna scadenza prossima.</p>}
          </article>

          <article className="card list-card warning">
            <h3>Scadenze passate</h3>
            {overdueActions.slice(0, 6).map((action) => (
              <div key={action.id} className="list-row">
                <span>{action.title}</span>
                <small>{action.dueDate ? format(new Date(action.dueDate), 'dd/MM HH:mm') : '-'}</small>
              </div>
            ))}
            {overdueActions.length === 0 && <p>Nessuna scadenza passata.</p>}
          </article>

          <article className="card span-2">
            <h3>Stato avanzamento priorita</h3>
            <div className="progress-list">
              {visiblePriorities.map((priority) => (
                <div key={priority.id} className="progress-card compact">
                  <div className="progress-head">
                    <div>
                      <strong>{priority.title}</strong>
                      <p>
                        Owner: {priority.owner}
                        {colorCategories[priority.color] ? ` · ${colorCategories[priority.color]}` : ''}
                      </p>
                    </div>
                    <strong style={{ color: priority.color }}>{categoryProgressMap.get(priority.id) ?? 0}%</strong>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${categoryProgressMap.get(priority.id) ?? 0}%`, backgroundColor: priority.color }} />
                  </div>
                </div>
              ))}
              {visiblePriorities.length === 0 && <p>Nessuna priorita.</p>}
            </div>
          </article>

          <article className="card home-sync-banner span-2">
            <div>
              <strong>{usesSupabase ? 'Cloud connesso' : 'Locale offline'}</strong>
              <small>{lastSyncAt ? `Ultima sync: ${format(new Date(lastSyncAt), 'dd/MM/yyyy HH:mm')}` : 'Nessuna sync eseguita'}</small>
            </div>
            <div className="mini-actions">
              <button type="button" onClick={() => void syncNow()} disabled={isSyncing}>
                {isSyncing ? 'Sync...' : 'Sincronizza'}
              </button>
              <button type="button" onClick={requestNotifications} disabled={notificationPermission === 'granted'}>
                {notificationPermission === 'granted'
                  ? 'Notifiche attive'
                  : notificationPermission === 'unsupported'
                    ? 'Non supportate'
                    : 'Notifiche'}
              </button>
            </div>
          </article>
        </section>
      )}

      {page === 'priorities' && (
        <section className="page-grid priorities-grid">
          <div className="stack">
            <details className="card panel-card" open>
              <summary>Nuova Priorita</summary>
              <form className="form-card details-form" onSubmit={handleCreatePriority}>
                <input value={priorityTitle} onChange={(event) => setPriorityTitle(event.target.value)} placeholder="Nome priorita" required />
                <label>
                  Owner priorita
                  <select value={priorityOwnerUserId} onChange={(event) => setPriorityOwnerUserId(event.target.value)} required>
                    <option value="">Seleziona utente</option>
                    {effectiveUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="color-row">
                  <span className="swatch" style={{ backgroundColor: priorityColor }} />
                  <select value={priorityColor} onChange={(event) => setPriorityColor(event.target.value)}>
                    {presetColors.map((color) => (
                      <option key={color.value} value={color.value}>
                        {getColorOptionLabel(color.value, colorCategories)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit">Aggiungi priorita</button>
              </form>
            </details>

            {editingPriorityId && (
              <details className="card panel-card" open>
                <summary>Modifica Priorita</summary>
                <form
                  className="form-card details-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSaveEditPriority();
                  }}
                >
                  <input
                    value={editingPriorityTitle}
                    onChange={(event) => setEditingPriorityTitle(event.target.value)}
                    placeholder="Titolo priorita"
                    required
                  />
                  <label className="color-row">
                    <span className="swatch" style={{ backgroundColor: editingPriorityColor }} />
                    <select value={editingPriorityColor} onChange={(event) => setEditingPriorityColor(event.target.value)}>
                      {presetColors.map((color) => (
                        <option key={color.value} value={color.value}>
                          {getColorOptionLabel(color.value, colorCategories)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="mini-actions">
                    <button type="submit">Salva modifica</button>
                    <button type="button" className="link-btn" onClick={handleCancelEditPriority}>
                      Annulla
                    </button>
                  </div>
                </form>
              </details>
            )}

            <details className="card panel-card">
              <summary>Nuova Azione</summary>
              <form className="form-card details-form" onSubmit={handleCreateAction}>
                <select value={actionPriorityId} onChange={(event) => setActionPriorityId(event.target.value)} required>
                  <option value="">Seleziona priorita</option>
                  {categories.map((priority) => (
                    <option key={priority.id} value={priority.id}>
                      {priority.title}
                    </option>
                  ))}
                </select>
                <textarea value={actionTitle} onChange={(event) => setActionTitle(event.target.value)} placeholder="Azione con @NomeUtente" rows={2} required />
                <MentionHelper users={effectiveUsers} onMention={(user) => setActionTitle((current) => appendMention(current, user))} />
                <input type="datetime-local" value={actionDueDate} onChange={(event) => setActionDueDate(event.target.value)} />
                <ReminderEditor
                  label="Reminder azione"
                  inputValue={actionReminderInput}
                  reminders={actionReminderList}
                  onInputChange={setActionReminderInput}
                  onAdd={addActionReminder}
                  onRemove={removeActionReminder}
                />
                <button type="submit">Aggiungi azione</button>
              </form>
            </details>

            <details className="card panel-card">
              <summary>Assegna Categoria colore</summary>
              <div className="details-form color-categories">
                {presetColors.map((color) => (
                  <label key={color.value} className="category-row">
                    <span className="category-label">
                      <span className="swatch" style={{ backgroundColor: color.value }} />
                      <span>{color.name}</span>
                    </span>
                    <input
                      value={colorCategories[color.value] ?? ''}
                      onChange={(event) => setColorCategories((current) => ({ ...current, [color.value]: event.target.value }))}
                      placeholder="Categoria (es. Sport Bambini)"
                    />
                  </label>
                ))}
              </div>
            </details>
          </div>

          <div className="stack">
            <article className="card list-card" ref={selectedDayCardRef}>
              <h3>Filtri Piano Priorita</h3>
              <div className="form-card">
                <label>
                  Filtro priorita
                  <select value={filterPriority} onChange={(event) => setFilterPriority(event.target.value)}>
                    <option value="all">Tutte</option>
                    {categories.map((priority) => (
                      <option key={priority.id} value={priority.id}>
                        {priority.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Filtro utente
                  <select value={filterUserId} onChange={(event) => setFilterUserId(event.target.value)}>
                    <option value="all">Tutti</option>
                    {effectiveUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Stato azioni
                  <select
                    value={priorityActionStatusFilter}
                    onChange={(event) => setPriorityActionStatusFilter(event.target.value as 'all' | 'open' | 'done')}
                  >
                    <option value="all">Tutte</option>
                    <option value="open">Aperte</option>
                    <option value="done">Fatte</option>
                  </select>
                </label>
              </div>
            </article>

            <article className="card">
              <h2>Piano Priorita</h2>
              <div className="progress-list">
                {visiblePriorities.map((priority) => {
                  const priorityActions = priorityPageActions.filter((action) => action.categoryId === priority.id);
                  if (priorityActionStatusFilter !== 'all' && priorityActions.length === 0) {
                    return null;
                  }

                  return (
                    <article key={priority.id} className="progress-card priority-card">
                      <SwipeActionRow
                        onEdit={() => handleStartEditPriority(priority.id, priority.title, priority.color)}
                        onDelete={() => handleDeletePriority(priority.id)}
                        leftAction={
                          (categoryProgressMap.get(priority.id) ?? 0) >= 100
                            ? { label: 'Riapri', onClick: () => handleReopenPriority(priority.id) }
                            : { label: 'Fatto', onClick: () => handleMarkPriorityDone(priority.id) }
                        }
                      >
                        <div className="progress-head hierarchy-row row-compact">
                          <div>
                            <small className="hierarchy-label">Priorita</small>
                            <h3>{priority.title}</h3>
                            <p>
                              Owner: {priority.owner}
                              {colorCategories[priority.color] ? ` · ${colorCategories[priority.color]}` : ''}
                            </p>
                          </div>
                          <div className="row-end">
                            <strong style={{ color: priority.color }}>{categoryProgressMap.get(priority.id) ?? 0}%</strong>
                            <button
                              type="button"
                              className="expand-btn"
                              onClick={() => setExpandedPriorityId((current) => (current === priority.id ? null : priority.id))}
                            >
                              {expandedPriorityId === priority.id ? '▾' : '▸'}
                            </button>
                          </div>
                        </div>
                      </SwipeActionRow>

                      {expandedPriorityId === priority.id && (
                        <div className="item-actions">
                          {priorityActions.map((action) => (
                            <SwipeActionRow
                              key={action.id}
                              onEdit={() => handleEditAction(action.id, action.title)}
                              onDelete={() => handleDeleteAction(action.id)}
                              leftAction={
                                action.percentComplete >= 100
                                  ? { label: 'Riapri', onClick: () => handleReopenAction(action.id) }
                                  : { label: 'Fatto', onClick: () => handleMarkActionDone(action.id) }
                              }
                            >
                              <div className="action-row action-row-readonly">
                                <div className="action-main">
                                  <span className="action-topline">
                                    <small className="hierarchy-label">Azione</small>
                                    <strong>{action.percentComplete}%</strong>
                                  </span>
                                  <span>{action.title}</span>
                                </div>
                                <small>{action.percentComplete >= 100 ? 'Fatta' : 'Aperta'}</small>
                              </div>
                            </SwipeActionRow>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
                {visiblePriorities.length === 0 && <p>Nessuna priorita trovata.</p>}
              </div>
            </article>
          </div>
        </section>
      )}

      {page === 'calendar' && (
        <section className="page-grid calendar-layout">
          <article className="card calendar-card">
            <div className="calendar-head">
              <h2>Calendario</h2>
              <div className="calendar-controls">
                <div className="segmented">
                  <button type="button" onClick={() => setCalendarView('month')} data-active={calendarView === 'month'}>
                    Mese
                  </button>
                  <button type="button" onClick={() => setCalendarView('week')} data-active={calendarView === 'week'}>
                    Settimana
                  </button>
                  <button type="button" onClick={() => setCalendarView('day')} data-active={calendarView === 'day'}>
                    Giorno
                  </button>
                </div>
                <div className="nav-row">
                  <button type="button" onClick={() => setCalendarDate((d) => moveAnchorDate(calendarView, d, 'prev'))}>
                    {'<'}
                  </button>
                  <strong>{getViewTitle(calendarView, calendarDate)}</strong>
                  <button type="button" onClick={() => setCalendarDate((d) => moveAnchorDate(calendarView, d, 'next'))}>
                    {'>'}
                  </button>
                </div>
              </div>
            </div>

            {calendarView === 'month' && (
              <div className="month-grid-wrap">
                <div className="weekday-row">
                  {weekdayLabels.map((label) => (
                    <div key={label}>{label}</div>
                  ))}
                </div>
                <div className="month-grid">
                  {monthGridDays.map((day) => {
                    const dayEvents = visibleCalendarEvents.filter((event) => isSameDay(event.startsAt, day));
                    const hasHoliday = dayEvents.some((event) => event.source === 'holiday');
                    return (
                      <button
                        type="button"
                        key={day.toISOString()}
                        className="day-cell"
                        data-muted={!isSameMonth(day, calendarDate)}
                        data-selected={isSameDay(day, selectedCalendarDate)}
                        onClick={() => selectCalendarDay(new Date(day))}
                      >
                        <span className="day-number">
                          {format(day, 'd')}
                          {hasHoliday && <span className="holiday-star">★</span>}
                        </span>
                        <div className="mini-events">
                          {dayEvents.slice(0, 3).map((event) => (
                            <span key={event.id} style={{ borderLeftColor: event.color }}>
                              {event.source === 'holiday' ? 'Festivita' : format(event.startsAt, 'HH:mm')} {event.title}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {calendarView === 'week' && (
              <div className="week-grid">
                {weekDays.map((day) => {
                  const dayEvents = visibleCalendarEvents.filter((event) => isSameDay(event.startsAt, day));
                  const hasHoliday = dayEvents.some((event) => event.source === 'holiday');
                  return (
                    <button
                      type="button"
                      key={day.toISOString()}
                      className="week-column"
                      data-selected={isSameDay(day, selectedCalendarDate)}
                      onClick={() => selectCalendarDay(new Date(day))}
                    >
                      <h4>
                        {format(day, 'EEE dd')}
                        {hasHoliday && <span className="holiday-star">★</span>}
                      </h4>
                      {dayEvents.length === 0 && <small>Nessun evento</small>}
                      {dayEvents.map((event) => (
                        <div key={event.id} className="calendar-event" style={{ borderLeftColor: event.color }}>
                          <strong>{event.title}</strong>
                          <p>
                            {event.source === 'holiday'
                              ? 'Festivita nazionale'
                              : `${format(event.startsAt, 'HH:mm')} - ${format(event.endsAt, 'HH:mm')}`}
                          </p>
                        </div>
                      ))}
                    </button>
                  );
                })}
              </div>
            )}

            {calendarView === 'day' && (
              <div className="day-list">
                {visibleCalendarEvents.length === 0 && <p>Nessun evento nel giorno selezionato.</p>}
                {visibleCalendarEvents.map((event) => (
                  <button type="button" key={event.id} className="agenda-row" onClick={() => selectCalendarDay(event.startsAt)}>
                    <span className="dot" style={{ backgroundColor: event.color }} />
                    <div>
                      <strong>{event.title}</strong>
                      <p>
                        {event.source === 'holiday'
                          ? `Festivita nazionale · ${format(event.startsAt, 'dd/MM')}`
                          : `${format(event.startsAt, 'dd/MM HH:mm')} - ${format(event.endsAt, 'HH:mm')}`}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </article>

          <aside className="stack">
            <article className="card list-card">
              <h3>
                Giorno selezionato: {format(selectedCalendarDate, 'dd/MM/yyyy')}
                {selectedDayEvents.some((event) => event.source === 'holiday') && <span className="holiday-star">★</span>}
              </h3>
              {selectedDayEvents.map((event) => (
                <div key={event.id} className="list-row block">
                  <div>
                    <strong>{event.title}</strong>
                    <small>
                      {event.source === 'holiday'
                        ? 'Festivita nazionale'
                        : `${format(event.startsAt, 'HH:mm')} - ${format(event.endsAt, 'HH:mm')}`}
                    </small>
                    {(colorCategories[event.color] || event.colorName) && <small>{colorCategories[event.color] || event.colorName}</small>}
                  </div>
                  {event.attachmentName && event.attachmentDataUrl && (
                    <a href={event.attachmentDataUrl} download={event.attachmentName}>
                      {event.attachmentName}
                    </a>
                  )}
                  {event.source === 'planest' && (
                    <div className="event-delete-row">
                      <button type="button" onClick={() => handleStartEditEvent(event)}>
                        Modifica evento
                      </button>
                      {event.isRecurring && (
                        <button type="button" onClick={() => void handleDeleteOccurrence(event)}>
                          Elimina occorrenza
                        </button>
                      )}
                      {event.isRecurring && (
                        <button type="button" onClick={() => void handleDeleteSeriesPartial(event)}>
                          Elimina da qui in poi
                        </button>
                      )}
                      <button type="button" onClick={() => void handleDeleteSeries(event)}>
                        {event.isRecurring ? 'Elimina serie' : 'Elimina evento'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {selectedDayEvents.length === 0 && <p>Nessuna attivita nel giorno.</p>}
            </article>

            <details className="card panel-card" open>
              <summary>Nuova Attivita Calendario</summary>
              <form className="form-card details-form" onSubmit={handleCreateEvent}>
                <textarea value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} placeholder="Titolo con @NomeUtente" rows={2} required />
                <MentionHelper users={effectiveUsers} onMention={(user) => setEventTitle((current) => appendMention(current, user))} />

                <select value={eventPriorityId} onChange={(event) => setEventPriorityId(event.target.value)}>
                  <option value="">Nessuna priorita</option>
                  {categories.map((priority) => (
                    <option key={priority.id} value={priority.id}>
                      {priority.title}
                    </option>
                  ))}
                </select>

                <input type="datetime-local" value={eventStartsAt} onChange={(event) => handleEventStartChange(event.target.value)} required />
                <input type="datetime-local" value={eventEndsAt} onChange={(event) => setEventEndsAt(event.target.value)} required />

                <select value={eventRecurrence} onChange={(event) => setEventRecurrence(event.target.value)}>
                  <option value="none">Nessuna ricorrenza</option>
                  <option value="daily">Ogni giorno</option>
                  <option value="weekly">Settimanale personalizzata</option>
                  <option value="monthly">Ogni mese</option>
                </select>

                {eventRecurrence === 'weekly' && (
                  <div className="weekday-picker">
                    {weekdayOptions.map((day) => (
                      <label key={day.value} className="weekday-chip">
                        <input
                          type="checkbox"
                          checked={eventRecurrenceWeekdays.includes(day.value)}
                          onChange={() => toggleWeekday(day.value)}
                        />
                        <span>{day.label}</span>
                      </label>
                    ))}
                  </div>
                )}

                {eventRecurrence !== 'none' && (
                  <label>
                    Fine ricorrenza
                    <input
                      type="date"
                      value={eventRecurrenceUntil}
                      min={eventStartsAt ? eventStartsAt.slice(0, 10) : undefined}
                      onChange={(event) => setEventRecurrenceUntil(event.target.value)}
                    />
                  </label>
                )}

                <div className="reminder-editor">
                  <label>Reminder evento</label>
                  <div className="reminder-row">
                    <select
                      value={eventReminderPreset}
                      onChange={(event) => setEventReminderPreset(event.target.value as '30m' | '15m' | '5m' | '1d' | 'custom')}
                    >
                      <option value="30m">30 min prima</option>
                      <option value="15m">15 min prima</option>
                      <option value="5m">5 min prima</option>
                      <option value="1d">1 giorno prima</option>
                      <option value="custom">Altro</option>
                    </select>
                    {eventReminderPreset === 'custom' && (
                      <input
                        type="datetime-local"
                        value={eventReminderCustomAt}
                        onChange={(event) => setEventReminderCustomAt(event.target.value)}
                      />
                    )}
                    <button type="button" onClick={addEventReminder}>
                      Aggiungi
                    </button>
                  </div>
                  {!eventStartsAt && eventReminderPreset !== 'custom' && (
                    <small>Imposta data/ora inizio per usare i reminder rapidi.</small>
                  )}
                  <div className="reminder-list">
                    {eventReminderList.length === 0 && <small>Nessun reminder.</small>}
                    {eventReminderList.map((reminder, idx) => (
                      <span key={`${reminder}-${idx}`} className="reminder-chip">
                        {formatReminder(reminder)}
                        <button type="button" onClick={() => removeEventReminder(idx)}>
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                <label>
                  Allegato
                  <input type="file" onChange={(event) => setEventFile(event.target.files?.[0] ?? null)} />
                </label>

                <label className="color-row">
                  <span className="swatch" style={{ backgroundColor: eventColor }} />
                  <select value={eventColor} onChange={(event) => setEventColor(event.target.value)}>
                    {presetColors.map((color) => (
                      <option key={color.value} value={color.value}>
                        {getColorOptionLabel(color.value, colorCategories)}
                      </option>
                    ))}
                  </select>
                </label>

                <button type="submit">{editingEventId ? 'Salva modifica evento' : 'Aggiungi evento'}</button>
                {eventFeedback && <small>{eventFeedback}</small>}
                {editingEventId && (
                  <button type="button" className="link-btn" onClick={handleCancelEditEvent}>
                    Annulla modifica
                  </button>
                )}
              </form>
            </details>
          </aside>
        </section>
      )}
    </div>
  );
}

export default App;
