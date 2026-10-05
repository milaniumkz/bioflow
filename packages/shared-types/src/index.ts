export const MATERIAL_STATES = ["DIRTY", "WASHED", "FINISHED"] as const;
export const WAYBILL_STATUSES = [
  "DRAFT",
  "CREATED",
  "LOADED",
  "IN_TRANSIT",
  "ARRIVED",
  "ACCEPTED",
  "ACCEPTED_WITH_DIFFERENCE",
  "REJECTED",
  "CANCELLED"
] as const;
export const INVENTORY_MOVEMENT_TYPES = [
  "RECEIPT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "WASH_INPUT",
  "WASH_OUTPUT",
  "PRODUCTION_INPUT",
  "PRODUCTION_OUTPUT",
  "WRITE_OFF",
  "CORRECTION",
  "SHIPMENT"
] as const;

export type MaterialState = (typeof MATERIAL_STATES)[number];
export type WaybillStatus = (typeof WAYBILL_STATUSES)[number];
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export interface ApiPage<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
