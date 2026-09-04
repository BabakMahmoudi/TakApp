import { getTableName } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

export type MockCond =
  | { kind: 'eq'; column: SQLiteTableColumn; value: unknown }
  | { kind: 'ne'; column: SQLiteTableColumn; value: unknown }
  | { kind: 'like'; column: SQLiteTableColumn; value: string }
  | { kind: 'inArray'; column: SQLiteTableColumn; values: unknown[] }
  | { kind: 'and'; conds: MockCond[] }
  | { kind: 'or'; conds: MockCond[] };

type SQLiteTableColumn = { name: string };

export interface MockDbTable {
  rows: Record<string, unknown>[];
  unique?: string[];
}

function dbColumnToRowKey(dbName: string): string {
  return dbName.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function isColumn(value: unknown): value is SQLiteTableColumn {
  return typeof value === 'object' && value !== null && typeof (value as SQLiteTableColumn).name === 'string';
}

function evalCond(cond: MockCond, row: Record<string, unknown>): boolean {
  const key = (column: SQLiteTableColumn): string => dbColumnToRowKey(column.name);
  switch (cond.kind) {
    case 'eq': {
      const expected = isColumn(cond.value) ? row[key(cond.value)] : cond.value;
      return row[key(cond.column)] === expected;
    }
    case 'ne': {
      const expected = isColumn(cond.value) ? row[key(cond.value)] : cond.value;
      return row[key(cond.column)] !== expected;
    }
    case 'like': {
      const value = row[key(cond.column)];
      if (value === null || value === undefined) return false;
      const pattern = String(cond.value).toLowerCase();
      const text = String(value).toLowerCase();
      if (pattern.startsWith('%') && pattern.endsWith('%')) return text.includes(pattern.slice(1, -1));
      if (pattern.endsWith('%')) return text.startsWith(pattern.slice(0, -1));
      if (pattern.startsWith('%')) return text.endsWith(pattern.slice(1));
      return text === pattern;
    }
    case 'inArray':
      return cond.values.includes(row[key(cond.column)]);
    case 'and':
      return cond.conds.every((child) => evalCond(child, row));
    case 'or':
      return cond.conds.some((child) => evalCond(child, row));
  }
}

export class MockDb {
  constructor(readonly tables: Record<string, MockDbTable>) {}

  table(name: string): MockDbTable {
    const table = this.tables[name];
    if (!table) throw new Error(`MockDb: unknown table "${name}"`);
    return table;
  }

  select(selection?: unknown) {
    return {
      from: (table: SQLiteTable) => new SelectQuery(this, getTableName(table), selection),
    };
  }

  insert(table: SQLiteTable) {
    return new InsertQuery(this, getTableName(table));
  }

  update(table: SQLiteTable) {
    return new UpdateQuery(this, getTableName(table));
  }

  delete(table: SQLiteTable) {
    return new DeleteQuery(this, getTableName(table));
  }

  async batch(queries: PromiseLike<unknown>[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const query of queries) {
      results.push(await query);
    }
    return results;
  }
}

class SelectQuery {
  private readonly joins: { name: string; on: MockCond }[] = [];
  private cond: MockCond | null = null;
  private limitN: number | null = null;

  constructor(
    private readonly db: MockDb,
    private readonly baseName: string,
    private readonly selection?: unknown,
  ) {}

  leftJoin(table: SQLiteTable, on: MockCond) {
    this.joins.push({ name: getTableName(table), on });
    return this;
  }

  where(cond: MockCond) {
    this.cond = cond;
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  then<TResult1 = Record<string, unknown>[], TResult2 = never>(
    onfulfilled?: ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private run(): Record<string, unknown>[] {
    const table = this.db.tables[this.baseName];
    if (!table) throw new Error(`MockDb: unknown table "${this.baseName}"`);
    let rows: Record<string, unknown>[] = table.rows;
    if (this.joins.length > 0) {
      let nested: Record<string, Record<string, unknown> | null>[] = rows.map((row) => ({ [this.baseName]: row }));
      for (const join of this.joins) {
        const joinTable = this.db.tables[join.name];
        if (!joinTable) throw new Error(`MockDb: unknown table "${join.name}"`);
        nested = nested.flatMap((baseRow) => {
          const mergedBase = { ...(baseRow[this.baseName] as Record<string, unknown>) };
          const matches = joinTable.rows.filter((joinRow) => evalCond(join.on, { ...mergedBase, ...joinRow }));
          return matches.length > 0
            ? matches.map((joinRow) => ({ ...baseRow, [join.name]: joinRow }))
            : [{ ...baseRow, [join.name]: null }];
        });
      }
      rows = nested as Record<string, unknown>[];
    }
    if (this.cond) {
      const cond = this.cond;
      rows = rows.filter((row) => evalCond(cond, this.flatten(row)));
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.selection) return rows.map((row) => this.project(row));
    return rows;
  }

  private flatten(row: Record<string, unknown>): Record<string, unknown> {
    if (this.joins.length === 0) return row;
    const flat: Record<string, unknown> = { ...(row[this.baseName] as Record<string, unknown>) };
    for (const join of this.joins) {
      const joinRow = row[join.name];
      if (joinRow && typeof joinRow === 'object') Object.assign(flat, joinRow);
    }
    return flat;
  }

  private project(row: Record<string, unknown>): Record<string, unknown> {
    if (!this.selection || typeof this.selection !== 'object') return row;
    const result: Record<string, unknown> = {};
    for (const [key, table] of Object.entries(this.selection as Record<string, SQLiteTable>)) {
      const rowKey = getTableName(table);
      result[key] = row[rowKey] ?? null;
    }
    return result;
  }
}

class InsertQuery {
  private valuesRow: Record<string, unknown> | null = null;
  private conflictHandled = false;

  constructor(
    private readonly db: MockDb,
    private readonly tableName: string,
  ) {}

  values(row: Record<string, unknown>) {
    this.valuesRow = row;
    return this;
  }

  onConflictDoNothing() {
    this.conflictHandled = true;
    return this;
  }

  returning() {
    return this;
  }

  then<TResult1 = Record<string, unknown>[], TResult2 = never>(
    onfulfilled?: ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private run(): Record<string, unknown>[] {
    const table = this.db.tables[this.tableName];
    if (!table) throw new Error(`MockDb: unknown table "${this.tableName}"`);
    if (!this.valuesRow) throw new Error('MockDb: insert called without values');
    const conflict = (table.unique ?? []).some((column) => {
      const value = this.valuesRow?.[column];
      if (value === null || value === undefined) return false;
      return table.rows.some((row) => row[column] === value);
    });
    if (conflict) {
      if (this.conflictHandled) return [];
      throw new Error(`MockDb: unique constraint violated on "${this.tableName}"`);
    }
    const ids = table.rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id));
    const row = { ...this.valuesRow };
    if (row.id === undefined) row.id = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    table.rows.push(row);
    return [row];
  }
}

class UpdateQuery {
  private setRow: Record<string, unknown> = {};
  private cond: MockCond | null = null;

  constructor(
    private readonly db: MockDb,
    private readonly tableName: string,
  ) {}

  set(row: Record<string, unknown>) {
    this.setRow = row;
    return this;
  }

  where(cond: MockCond) {
    this.cond = cond;
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private run(): { success: true; meta: { changes: number } } {
    const table = this.db.tables[this.tableName];
    if (!table) throw new Error(`MockDb: unknown table "${this.tableName}"`);
    let changes = 0;
    for (const row of table.rows) {
      if (this.cond && !evalCond(this.cond, row)) continue;
      Object.assign(row, this.setRow);
      changes++;
    }
    return { success: true, meta: { changes } };
  }
}

class DeleteQuery {
  private cond: MockCond | null = null;

  constructor(
    private readonly db: MockDb,
    private readonly tableName: string,
  ) {}

  where(cond: MockCond) {
    this.cond = cond;
    return this;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private run(): { success: true; meta: { changes: number } } {
    const table = this.db.tables[this.tableName];
    if (!table) throw new Error(`MockDb: unknown table "${this.tableName}"`);
    const before = table.rows.length;
    table.rows = table.rows.filter((row) => (this.cond ? !evalCond(this.cond, row) : false));
    return { success: true, meta: { changes: before - table.rows.length } };
  }
}
