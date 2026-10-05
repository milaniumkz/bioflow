import { BadRequestException } from "@nestjs/common";

export interface DateRangeQuery {
  dateFrom?: string;
  dateTo?: string;
}

export function createdAtRange(query: DateRangeQuery) {
  const range: { gte?: Date; lte?: Date } = {};
  if (query.dateFrom) range.gte = parseDate(query.dateFrom, "dateFrom", false);
  if (query.dateTo) range.lte = parseDate(query.dateTo, "dateTo", true);
  if (range.gte && range.lte && range.gte > range.lte) throw new BadRequestException("dateFrom must be before dateTo");
  return Object.keys(range).length > 0 ? { createdAt: range } : {};
}

function parseDate(value: string, field: string, endOfDay: boolean) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && endOfDay) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}
