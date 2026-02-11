export type UUID = string;

export type BaseEntity = {
  id: UUID;
  createdAt: string;
  updatedAt: string;
};

export type UserProfile = {
  id: UUID;
  email: string | null;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

export type PriorityCategory = BaseEntity & {
  title: string;
  owner: string;
  ownerUserId: UUID | null;
  color: string;
  colorName: string | null;
};

export type PlanAction = BaseEntity & {
  categoryId: UUID;
  title: string;
  percentComplete: number;
  dueDate: string | null;
  reminders: string[];
  mentionUserIds: UUID[];
};

export type CalendarEvent = BaseEntity & {
  categoryId: UUID | null;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  recurrenceRule: string | null;
  exceptionDates: string[];
  reminders: string[];
  mentionUserIds: UUID[];
  color: string;
  colorName: string | null;
  attachmentName: string | null;
  attachmentDataUrl: string | null;
};

export type Mutation = {
  id?: number;
  table: 'categories' | 'actions' | 'events' | 'profiles';
  op: 'upsert' | 'delete';
  payload: Record<string, unknown>;
  createdAt: string;
};

export type WeeklySummary = {
  completedActions: number;
  incompleteActions: number;
  dueThisWeek: number;
  eventsThisWeek: number;
};
