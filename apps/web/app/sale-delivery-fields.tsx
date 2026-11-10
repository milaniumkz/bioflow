"use client";
import { useState } from "react";
import { Field, Reference } from "./workflow-ui";
type Row = Record<string, any>;
export function SaleDeliveryFields({
  drivers,
  vehicles,
}: {
  drivers: Row[];
  vehicles: Row[];
}) {
  const [delivery, setDelivery] = useState(false),
    [tracking, setTracking] = useState(false);
  return (
    <fieldset>
      <legend>Доставка покупателю — необязательно</legend>
      <label>
        <input
          type="checkbox"
          name="withDelivery"
          checked={delivery}
          onChange={(e) => setDelivery(e.target.checked)}
        />
        Оформить доставку
      </label>
      {delivery && (
        <>
          <Field name="deliveryDestination" label="Адрес покупателя" />
          <Field name="deliveryRoute" label="Маршрут доставки" />
          <label>
            <input
              type="checkbox"
              name="deliveryTracking"
              checked={tracking}
              onChange={(e) => setTracking(e.target.checked)}
            />
            Отслеживать машину по GPS
          </label>
          <Reference
            name="deliveryDriverId"
            label="Водитель доставки"
            rows={drivers.filter(
              (d) => !d.archivedAt && (!tracking || d.userId),
            )}
            required={tracking}
          />
          <Reference
            name="deliveryVehicleId"
            label="Машина доставки"
            rows={vehicles.filter(
              (v) => !v.archivedAt && v.status === "ACTIVE",
            )}
            required={tracking}
          />
          <p>
            {tracking
              ? "Рейс появится у выбранного водителя. В браузере GPS передаётся, пока открыта страница; для фоновой записи используется Android-приложение."
              : "Доставка оформится без передачи геолокации. Машину и водителя можно не указывать."}
          </p>
        </>
      )}
    </fieldset>
  );
}
export function saleDeliveryPayload(f: FormData) {
  const {
    withDelivery,
    deliveryTracking,
    deliveryDestination,
    deliveryRoute,
    deliveryDriverId,
    deliveryVehicleId,
    ...data
  } = Object.fromEntries(f);
  return {
    ...data,
    ...(withDelivery
      ? {
          delivery: {
            destination: deliveryDestination,
            route: deliveryRoute,
            driverId: deliveryDriverId || undefined,
            vehicleId: deliveryVehicleId || undefined,
            trackingEnabled: !!deliveryTracking,
          },
        }
      : {}),
  };
}
