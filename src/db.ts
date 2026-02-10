import Dexie, { type Table } from 'dexie';
import type { CalendarEvent, Mutation, PlanAction, PlanItem, PriorityCategory, UserProfile } from './types';

class PlanestDB extends Dexie {
  categories!: Table<PriorityCategory, string>;
  items!: Table<PlanItem, string>;
  actions!: Table<PlanAction, string>;
  events!: Table<CalendarEvent, string>;
  profiles!: Table<UserProfile, string>;
  mutations!: Table<Mutation, number>;

  constructor() {
    super('planest_db');
    this.version(1).stores({
      categories: 'id, owner, updatedAt',
      items: 'id, categoryId, updatedAt',
      actions: 'id, itemId, dueDate, updatedAt',
      events: 'id, categoryId, startsAt, updatedAt',
      mutations: '++id, table, op, createdAt',
    });

    this.version(2).stores({
      categories: 'id, ownerUserId, owner, updatedAt',
      items: 'id, categoryId, updatedAt',
      actions: 'id, itemId, dueDate, updatedAt',
      events: 'id, categoryId, startsAt, updatedAt',
      profiles: 'id, displayName, updatedAt',
      mutations: '++id, table, op, createdAt',
    });
  }
}

export const db = new PlanestDB();

export const createId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(36).slice(2)}`;
};

export const nowIso = (): string => new Date().toISOString();
